import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import './db.js';
import { loadUser, requireAdmin, ensureFirstAdmin, purgeExpiredSessions } from './auth.js';
import { HttpError } from './util.js';
import { contentRouter } from './routes/content.js';
import { enquiriesRouter } from './routes/enquiries.js';
import { authRouter, usersRouter, settingsRouter, dashboardRouter } from './routes/account.js';
import { publicRouter } from './routes/public.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

app.use(
  helmet({
    // Uploaded media is embedded by the website, which lives on another origin.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'blob:', 'https:'],
        frameSrc: ['https://www.youtube.com', 'https://player.vimeo.com', 'https://www.facebook.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
  }),
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Uploaded files: random names, so they can be cached aggressively.
app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Public API for the website
app.use('/api/public', publicRouter);

// Admin API
app.use('/api', loadUser);
app.use('/api/auth', authRouter);
app.use('/api/admin', requireAdmin);
app.get('/api/admin/meta', (_req, res) =>
  res.json({ publicBaseUrl: config.publicBaseUrl, allowedOrigins: config.allowedOrigins, limits: config.limits }),
);
app.use('/api/admin/dashboard', dashboardRouter);
app.use('/api/admin/enquiries', enquiriesRouter);
app.use('/api/admin/users', usersRouter);
app.use('/api/admin/settings', settingsRouter);
app.use('/api/admin', contentRouter);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint not found.')));

// Admin panel (static single-page app)
app.use(express.static(config.adminDir, { index: 'index.html', maxAge: 0 }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  if (err.type === 'entity.parse.failed') message = 'Invalid JSON body.';
  else if (err.type === 'entity.too.large') message = 'Request is too large.';
  else if (/SQLITE_CONSTRAINT|constraint failed/i.test(err.message || '')) {
    status = 409;
    message = 'This conflicts with existing data.';
  }
  if (status >= 500) {
    console.error(err);
    message = 'Something went wrong on the server.';
  }
  if (req.path.startsWith('/api') || req.accepts(['json', 'html']) === 'json') {
    return res.status(status).json({ error: message, ...(err.details ? { fields: err.details } : {}) });
  }
  res.status(status).type('text').send(message);
});

await ensureFirstAdmin();
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`Control panel running at ${config.publicBaseUrl}  (port ${config.port})`);
  console.log(`Public API:              ${config.publicBaseUrl}/api/public`);
  console.log(`Data:                    ${config.dataDir}  (uploads: ${config.uploadDir})`);
  if (!config.allowedOrigins.length) console.log('Note: ALLOWED_ORIGINS is empty, so browsers on other sites cannot call the public API yet.');
});
