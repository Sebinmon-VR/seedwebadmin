/**
 * Public, read-only content API for the website (plus the admission enquiry form).
 * Everything here returns only published, currently-visible content with absolute file URLs.
 */
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db, plain, plainAll } from '../db.js';
import { config } from '../config.js';
import { HttpError, clientIp, nowIso, pageParams, likeTerm, fileUrl, embedUrl, linkThumbnail, absolutizeHtml } from '../util.js';
import { eventWhen, eventState } from './content.js';
import { createEnquiry } from './enquiries.js';
import { readSettings } from './account.js';

export const publicRouter = express.Router();

/* ---------------------------------------------------------------- CORS */

const originAllowed = (origin) =>
  !!origin && (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin.replace(/\/+$/, '')));

publicRouter.use((req, res, next) => {
  const origin = req.get('Origin');
  if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', config.allowedOrigins.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  // Public content can be cached briefly by browsers/CDNs.
  if (req.method === 'GET') res.setHeader('Cache-Control', 'public, max-age=60');
  next();
});

/* ---------------------------------------------------------------- serializers */

const abs = (p) => fileUrl(p, true);

const pubPost = (p, full = false) => ({
  id: p.id,
  title: p.title,
  slug: p.slug,
  category: p.category,
  excerpt: p.excerpt,
  cover_image_url: abs(p.cover_image),
  published_at: p.published_at,
  updated_at: p.updated_at,
  ...(full ? { content: absolutizeHtml(p.content) } : {}),
});

const pubImage = (g) => ({
  id: g.id,
  title: g.title,
  caption: g.caption,
  album: g.album,
  url: abs(g.file),
  is_featured: !!g.is_featured,
  created_at: g.created_at,
});

const pubVideo = (v) => ({
  id: v.id,
  title: v.title,
  description: v.description,
  category: v.category,
  source: v.source,
  video_url: v.source === 'upload' ? abs(v.file) : v.url,
  embed_url: v.source === 'link' ? embedUrl(v.url) : null,
  thumbnail_url: abs(v.thumbnail) || (v.source === 'link' ? linkThumbnail(v.url) : null),
  is_featured: !!v.is_featured,
  created_at: v.created_at,
});

const pubEvent = (e) => ({
  id: e.id,
  title: e.title,
  description: e.description,
  venue: e.venue,
  start_at: e.start_at,
  end_at: e.end_at,
  cover_image_url: abs(e.cover_image),
  state: eventState(e), // upcoming | live | past | cancelled
  live_url: e.live_url,
  live_embed_url: embedUrl(e.live_url),
});

const pubNotice = (n) => ({
  id: n.id,
  title: n.title,
  body: n.body,
  category: n.category,
  priority: n.priority,
  is_pinned: !!n.is_pinned,
  show_in_ticker: !!n.show_in_ticker,
  attachment_url: abs(n.attachment),
  attachment_name: n.attachment_name,
  published_at: n.publish_at || n.created_at,
  expires_at: n.expires_at,
});

/* ---------------------------------------------------------------- query helpers */

function paged(res, table, where, params, order, map, query, maxLimit = 50) {
  const { page, limit, offset } = pageParams(query, maxLimit);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${table} ${w}`).get(...params);
  const rows = plainAll(db.prepare(`SELECT * FROM ${table} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset));
  res.json({ items: rows.map((r) => map(r)), total, page, limit, pages: Math.ceil(total / limit) });
}

const postScope = () => ({ where: [`status = 'published'`, 'published_at <= ?'], params: [nowIso()] });

const noticeScope = () => {
  const now = nowIso();
  return {
    where: [`status = 'published'`, '(publish_at IS NULL OR publish_at <= ?)', '(expires_at IS NULL OR expires_at > ?)'],
    params: [now, now],
  };
};
const NOTICE_ORDER = `is_pinned DESC, CASE priority WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
  COALESCE(publish_at, created_at) DESC, id DESC`;

/* ---------------------------------------------------------------- routes */

publicRouter.get('/settings', (_req, res) => {
  const { site_logo, ...s } = readSettings();
  res.json({ ...s, site_logo_url: abs(site_logo) });
});

/** One call for a typical homepage: ticker, notices, live/upcoming events, latest posts, featured media. */
publicRouter.get('/home', (_req, res) => {
  const n = noticeScope();
  const p = postScope();
  const live = [`status = 'published'`];
  const liveP = [];
  eventWhen('live', live, liveP);
  const up = [`status IN ('published','cancelled')`];
  const upP = [];
  eventWhen('upcoming', up, upP);
  const all = (sql, ...params) => plainAll(db.prepare(sql).all(...params));
  const { site_logo, ...settings } = readSettings();

  res.json({
    settings: { ...settings, site_logo_url: abs(site_logo) },
    ticker: all(`SELECT * FROM notices WHERE ${n.where.join(' AND ')} AND show_in_ticker = 1 ORDER BY ${NOTICE_ORDER} LIMIT 10`, ...n.params).map(pubNotice),
    notices: all(`SELECT * FROM notices WHERE ${n.where.join(' AND ')} ORDER BY ${NOTICE_ORDER} LIMIT 6`, ...n.params).map(pubNotice),
    live_events: all(`SELECT * FROM events WHERE ${live.join(' AND ')} ORDER BY start_at`, ...liveP).map(pubEvent),
    upcoming_events: all(`SELECT * FROM events WHERE ${up.join(' AND ')} ORDER BY start_at LIMIT 6`, ...upP).map(pubEvent),
    latest_posts: all(`SELECT * FROM posts WHERE ${p.where.join(' AND ')} ORDER BY published_at DESC LIMIT 6`, ...p.params).map((r) => pubPost(r)),
    featured_images: all(`SELECT * FROM gallery WHERE status = 'published' AND is_featured = 1 ORDER BY created_at DESC LIMIT 12`).map(pubImage),
    featured_videos: all(`SELECT * FROM videos WHERE status = 'published' AND is_featured = 1 ORDER BY created_at DESC LIMIT 6`).map(pubVideo),
  });
});

publicRouter.get('/posts', (req, res) => {
  const { where, params } = postScope();
  if (req.query.category) {
    where.push('category = ?');
    params.push(String(req.query.category));
  }
  if (req.query.q) {
    where.push(`(title LIKE ? ESCAPE '\\' OR excerpt LIKE ? ESCAPE '\\')`);
    params.push(likeTerm(req.query.q), likeTerm(req.query.q));
  }
  paged(res, 'posts', where, params, 'published_at DESC, id DESC', (r) => pubPost(r), req.query);
});

publicRouter.get('/posts/:slug', (req, res) => {
  const { where, params } = postScope();
  const row = plain(db.prepare(`SELECT * FROM posts WHERE ${where.join(' AND ')} AND slug = ?`).get(...params, req.params.slug));
  if (!row) throw new HttpError(404, 'Post not found.');
  res.json(pubPost(row, true));
});

publicRouter.get('/gallery/albums', (_req, res) => {
  const rows = plainAll(
    db
      .prepare(
        `SELECT album, COUNT(*) AS count, MAX(created_at) AS updated_at,
           (SELECT file FROM gallery g2 WHERE g2.album = g.album AND g2.status = 'published'
            ORDER BY g2.is_featured DESC, g2.created_at DESC LIMIT 1) AS cover
         FROM gallery g WHERE status = 'published' AND album IS NOT NULL AND album <> ''
         GROUP BY album ORDER BY updated_at DESC`,
      )
      .all(),
  );
  res.json({ items: rows.map(({ cover, ...r }) => ({ ...r, cover_url: abs(cover) })) });
});

publicRouter.get('/gallery', (req, res) => {
  const where = [`status = 'published'`];
  const params = [];
  if (req.query.album) {
    where.push('album = ?');
    params.push(String(req.query.album));
  }
  if (req.query.featured === '1') where.push('is_featured = 1');
  paged(res, 'gallery', where, params, 'created_at DESC, id DESC', pubImage, req.query, 100);
});

publicRouter.get('/videos', (req, res) => {
  const where = [`status = 'published'`];
  const params = [];
  if (req.query.category) {
    where.push('category = ?');
    params.push(String(req.query.category));
  }
  if (req.query.featured === '1') where.push('is_featured = 1');
  paged(res, 'videos', where, params, 'created_at DESC, id DESC', pubVideo, req.query);
});

publicRouter.get('/events', (req, res) => {
  const when = ['upcoming', 'live', 'past'].includes(req.query.when) ? req.query.when : 'all';
  const where = [when === 'live' ? `status = 'published'` : `status IN ('published','cancelled')`];
  const params = [];
  eventWhen(when, where, params);
  const order = when === 'upcoming' || when === 'live' ? 'start_at ASC, id' : 'start_at DESC, id DESC';
  paged(res, 'events', where, params, order, pubEvent, req.query);
});

publicRouter.get('/events/:id', (req, res) => {
  const row = plain(db.prepare(`SELECT * FROM events WHERE id = ? AND status IN ('published','cancelled')`).get(Number(req.params.id)));
  if (!row) throw new HttpError(404, 'Event not found.');
  res.json(pubEvent(row));
});

publicRouter.get('/notices', (req, res) => {
  const { where, params } = noticeScope();
  if (req.query.category) {
    where.push('category = ?');
    params.push(String(req.query.category));
  }
  if (req.query.ticker === '1') where.push('show_in_ticker = 1');
  paged(res, 'notices', where, params, NOTICE_ORDER, pubNotice, req.query);
});

publicRouter.get('/notices/:id', (req, res) => {
  const { where, params } = noticeScope();
  const row = plain(db.prepare(`SELECT * FROM notices WHERE ${where.join(' AND ')} AND id = ?`).get(...params, Number(req.params.id)));
  if (!row) throw new HttpError(404, 'Notice not found.');
  res.json(pubNotice(row));
});

/* ---------------------------------------------------------------- admission enquiries */

const enquiryLimiter = rateLimit({
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many enquiries from this device. Please try again in a few minutes.' },
});

/** Only redirect plain-HTML form posts back to a page on an allowed website. */
function safeRedirect(target) {
  try {
    const u = new URL(String(target));
    return originAllowed(u.origin) && !config.allowedOrigins.includes('*') ? u : null;
  } catch {
    return null;
  }
}

publicRouter.post('/enquiries', enquiryLimiter, (req, res) => {
  const body = req.body || {};
  const redirect = body._redirect ? safeRedirect(body._redirect) : null;
  const done = (status, payload, flag) => {
    if (redirect) {
      redirect.searchParams.set('enquiry', flag);
      return res.redirect(303, redirect.toString());
    }
    res.status(status).json(payload);
  };

  // Honeypot: a hidden "website" field real visitors never fill in.
  if (body.website) return done(201, { ok: true, message: 'Thank you! We will contact you soon.' }, 'sent');

  try {
    createEnquiry(body, { ip: clientIp(req), defaultSource: 'website' });
  } catch (err) {
    if (redirect && err instanceof HttpError) return done(err.status, {}, 'error');
    throw err;
  }
  done(201, { ok: true, message: 'Thank you! Your admission enquiry has been received. We will contact you soon.' }, 'sent');
});
