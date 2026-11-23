import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, plain } from './db.js';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'cp_session';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    expires.toISOString(),
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    expires,
    path: '/',
  });
}

export function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function destroyUserSessions(userId, exceptReq) {
  const keep = exceptReq ? readCookie(exceptReq, COOKIE) : null;
  if (keep) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, sha256(keep));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Attach req.user when a valid session cookie is present. */
export function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = plain(
      db
        .prepare(
          `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(sha256(token), new Date().toISOString()),
    );
    if (row) req.user = row;
  }
  next();
}

/**
 * Require a signed-in admin. State-changing requests must also carry the
 * X-Requested-With header: browsers can't add custom headers cross-site without
 * a CORS preflight (which admin routes never grant), so this blocks CSRF.
 */
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Missing request header.' });
  }
  next();
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

/** Create the first admin from env (or a generated password) when the users table is empty. */
export async function ensureFirstAdmin() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;
  // Hold ADMIN_PASSWORD to the same minimum as every other password; fall back to a random one.
  const weak = config.adminPassword ? validatePassword(config.adminPassword) : null;
  if (weak) console.warn(`ADMIN_PASSWORD ignored: ${weak} A random password was generated instead.`);
  const generated = !config.adminPassword || !!weak;
  const password = generated ? crypto.randomBytes(9).toString('base64url') : config.adminPassword;
  db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(
    'Administrator',
    config.adminEmail,
    await hashPassword(password),
  );
  const line = '-'.repeat(60);
  console.log(`\n${line}\n First admin account created\n   Email:    ${config.adminEmail}`);
  if (generated) console.log(`   Password: ${password}\n   (Change it from My account after signing in.)`);
  console.log(`${line}\n`);
}
