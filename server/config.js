import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

/**
 * Azure App Service (Linux) sets WEBSITE_SITE_NAME. There, everything under /home is
 * persistent storage that survives restarts and redeploys, while /home/site/wwwroot is
 * replaced on every deploy, so data must live outside the app folder.
 */
const onAzure = !!env.WEBSITE_SITE_NAME;
const azureData = '/home/data/seedwebadmin';

const port = num(env.PORT, 4000);
const dataDir = env.DATA_DIR || (onAzure ? azureData : path.join(root, 'data'));

export const config = {
  root,
  port,
  onAzure,
  publicBaseUrl: (
    env.PUBLIC_BASE_URL ||
    (env.WEBSITE_HOSTNAME ? `https://${env.WEBSITE_HOSTNAME}` : `http://localhost:${port}`)
  ).replace(/\/+$/, ''),
  dataDir,
  uploadDir: env.UPLOAD_DIR || (onAzure ? path.join(dataDir, 'uploads') : path.join(root, 'uploads')),
  adminDir: path.join(root, 'admin'),
  // WAL needs shared memory, which network file shares (like Azure's /home) don't support reliably.
  sqliteJournalMode: (env.SQLITE_JOURNAL_MODE || (onAzure ? 'DELETE' : 'WAL')).toUpperCase(),
  // The website's address (where its site-images.json lives). Can also be set in Website settings.
  websiteUrl: (env.WEBSITE_URL || '').trim().replace(/\/+$/, ''),
  allowedOrigins: (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  // Number of reverse proxies in front of the app (nginx, Azure front end...). Needed for correct client IPs.
  trustProxy: env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== '' ? Number(env.TRUST_PROXY) || 0 : onAzure ? 1 : 0,
  cookieSecure: bool(env.COOKIE_SECURE, onAzure),
  sessionDays: 7,
  adminEmail: env.ADMIN_EMAIL || 'admin@example.com',
  adminPassword: env.ADMIN_PASSWORD || '',
  limits: {
    imageMb: num(env.MAX_IMAGE_MB, 10),
    videoMb: num(env.MAX_VIDEO_MB, 300),
    fileMb: num(env.MAX_FILE_MB, 20),
  },
};
