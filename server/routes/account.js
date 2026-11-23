import crypto from 'node:crypto';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db, plain, plainAll } from '../db.js';
import { parseBody } from '../crud.js';
import { uploader, cleanupRequestFiles, removeFile } from '../upload.js';
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  createSession,
  destroySession,
  destroyUserSessions,
  requireAdmin,
} from '../auth.js';
import { HttpError, clientIp, nowIso, fileUrl } from '../util.js';
import { eventWhen } from './content.js';

/* ---------------------------------------------------------------- auth */

export const authRouter = express.Router();

// Compared against when the email doesn't exist, so failed logins take the same time either way.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

const loginLimiter = rateLimit({
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const user = plain(db.prepare('SELECT * FROM users WHERE email = ?').get(email));
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  const ok = await verifyPassword(password, user?.password_hash || DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Incorrect email or password.');
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  createSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) throw new HttpError(401, 'Not signed in.');
  res.json({ user: req.user });
});

/* ---------------------------------------------------------------- admin accounts */

export const usersRouter = express.Router();

usersRouter.get('/', (_req, res) => {
  const items = plainAll(db.prepare('SELECT id, name, email, created_at, last_login_at FROM users ORDER BY created_at').all());
  res.json({ items });
});

const userFields = [
  { name: 'name', type: 'text', required: true, max: 100, label: 'Name' },
  { name: 'email', type: 'email', required: true, max: 160, label: 'Email' },
];

usersRouter.post('/', uploader({}), async (req, res) => {
  const data = parseBody(userFields, req.body, { partial: false });
  const pwErr = validatePassword(req.body?.password);
  if (pwErr) throw new HttpError(422, pwErr, { password: pwErr });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(data.email)) {
    throw new HttpError(409, 'An admin with this email already exists.', { email: 'taken' });
  }
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(data.name, data.email, await hashPassword(req.body.password), nowIso());
  res.status(201).json({ id: Number(info.lastInsertRowid), ...data });
});

usersRouter.patch('/me', (req, res) => {
  const data = parseBody(userFields, req.body, { partial: true });
  if (data.email && db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(data.email, req.user.id)) {
    throw new HttpError(409, 'Another admin already uses this email.', { email: 'taken' });
  }
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => data[k]), req.user.id);
  }
  res.json({ user: plain(db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.id)) });
});

usersRouter.post('/me/password', async (req, res) => {
  const { current_password: current, new_password: next } = req.body || {};
  const row = plain(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id));
  if (!(await verifyPassword(String(current || ''), row.password_hash))) {
    throw new HttpError(422, 'Current password is incorrect.', { current_password: 'invalid' });
  }
  const pwErr = validatePassword(next);
  if (pwErr) throw new HttpError(422, pwErr, { new_password: pwErr });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), req.user.id);
  destroyUserSessions(req.user.id, req); // sign out other devices
  res.json({ ok: true });
});

usersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, "You can't remove your own account.");
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n <= 1) throw new HttpError(400, 'At least one admin account must remain.');
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (!info.changes) throw new HttpError(404, 'Admin not found.');
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- website settings */

export const SETTINGS = [
  { name: 'site_name', type: 'text', max: 120, label: 'Website name' },
  { name: 'tagline', type: 'text', max: 200, label: 'Tagline' },
  { name: 'contact_phone', type: 'text', max: 40, label: 'Phone' },
  { name: 'contact_email', type: 'email', max: 160, label: 'Email' },
  { name: 'whatsapp', type: 'text', max: 40, label: 'WhatsApp number' },
  { name: 'address', type: 'longtext', max: 500, label: 'Address' },
  { name: 'office_hours', type: 'text', max: 200, label: 'Office hours' },
  { name: 'map_url', type: 'url', label: 'Map link' },
  { name: 'facebook_url', type: 'url', label: 'Facebook' },
  { name: 'instagram_url', type: 'url', label: 'Instagram' },
  { name: 'youtube_url', type: 'url', label: 'YouTube' },
  { name: 'x_url', type: 'url', label: 'X / Twitter' },
  { name: 'linkedin_url', type: 'url', label: 'LinkedIn' },
  { name: 'admissions_open', type: 'bool', label: 'Admissions open' },
  { name: 'admission_message', type: 'longtext', max: 1000, label: 'Admission message' },
];
const BOOL_SETTINGS = new Set(SETTINGS.filter((s) => s.type === 'bool').map((s) => s.name));

export function readSettings() {
  const out = Object.fromEntries(SETTINGS.map((s) => [s.name, s.type === 'bool' ? false : '']));
  out.site_logo = null;
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (key in out) out[key] = BOOL_SETTINGS.has(key) ? value === '1' : value ?? '';
  }
  return out;
}

export const settingsRouter = express.Router();

settingsRouter.get('/', (_req, res) => {
  const s = readSettings();
  res.json({ ...s, site_logo_url: fileUrl(s.site_logo) });
});

settingsRouter.put('/', uploader({ site_logo: 'image' }), (req, res) => {
  try {
    const data = parseBody(SETTINGS, req.body, { partial: true });
    const current = readSettings();
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(data)) upsert.run(k, v === null ? '' : String(v));
    const logo = req.saved?.site_logo?.[0];
    if (logo || ['1', 'true'].includes(String(req.body?.remove_site_logo))) {
      upsert.run('site_logo', logo || '');
      if (current.site_logo) removeFile(current.site_logo);
    }
    const s = readSettings();
    res.json({ ...s, site_logo_url: fileUrl(s.site_logo) });
  } catch (err) {
    cleanupRequestFiles(req);
    throw err;
  }
});

/* ---------------------------------------------------------------- dashboard */

export const dashboardRouter = express.Router();

dashboardRouter.get('/', (_req, res) => {
  const now = nowIso();
  const count = (sql, ...p) => db.prepare(sql).get(...p).n;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  const live = [];
  const liveP = [];
  eventWhen('live', live, liveP);
  const upcoming = [];
  const upP = [];
  eventWhen('upcoming', upcoming, upP);

  // Enquiries per day for the last 14 days (UTC days).
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const perDay = Object.fromEntries(
    db
      .prepare('SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n FROM enquiries WHERE created_at >= ? GROUP BY d')
      .all(`${days[0]}T00:00:00.000Z`)
      .map((r) => [r.d, r.n]),
  );

  res.json({
    counts: {
      posts_published: count(`SELECT COUNT(*) AS n FROM posts WHERE status = 'published'`),
      posts_draft: count(`SELECT COUNT(*) AS n FROM posts WHERE status = 'draft'`),
      images: count('SELECT COUNT(*) AS n FROM gallery'),
      videos: count('SELECT COUNT(*) AS n FROM videos'),
      events_upcoming: count(`SELECT COUNT(*) AS n FROM events WHERE status = 'published' AND ${upcoming.join(' AND ')}`, ...upP),
      events_live: count(`SELECT COUNT(*) AS n FROM events WHERE status = 'published' AND ${live.join(' AND ')}`, ...liveP),
      notices_active: count(
        `SELECT COUNT(*) AS n FROM notices WHERE status = 'published'
         AND (publish_at IS NULL OR publish_at <= ?) AND (expires_at IS NULL OR expires_at > ?)`,
        now,
        now,
      ),
      enquiries_new: count(`SELECT COUNT(*) AS n FROM enquiries WHERE status = 'new'`),
      enquiries_week: count('SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= ?', weekAgo),
      enquiries_total: count('SELECT COUNT(*) AS n FROM enquiries'),
    },
    enquiries_by_day: days.map((d) => ({ date: d, count: perDay[d] || 0 })),
    recent_enquiries: plainAll(
      db.prepare('SELECT id, student_name, parent_name, phone, class_applying, status, created_at FROM enquiries ORDER BY created_at DESC LIMIT 6').all(),
    ),
    live_events: plainAll(
      db.prepare(`SELECT id, title, venue, start_at, end_at, live_url FROM events WHERE status = 'published' AND ${live.join(' AND ')} ORDER BY start_at`).all(...liveP),
    ),
    upcoming_events: plainAll(
      db
        .prepare(`SELECT id, title, venue, start_at, end_at FROM events WHERE status = 'published' AND ${upcoming.join(' AND ')} ORDER BY start_at LIMIT 5`)
        .all(...upP),
    ),
  });
});

export { requireAdmin };
