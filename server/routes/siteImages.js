/**
 * "Website images": every picture built into the website, which admins can replace.
 *
 * The website publishes the list of its pictures at <website>/site-images.json
 * ({ images: [{ key, src, label, pages, group }] }). This panel stores only the
 * replacements; the website asks for them (public API) and swaps them in. Until a picture
 * is replaced, the website keeps showing its own built-in image.
 */
import express from 'express';
import { db, plain, plainAll } from '../db.js';
import { config } from '../config.js';
import { uploader, cleanupRequestFiles, removeFile } from '../upload.js';
import { HttpError, nowIso, fileUrl, isHttpUrl } from '../util.js';
import { readSettings } from './account.js';

/** e.g. "team/principal", "gallery/yoga-day", "logo-footer" */
export const SITE_IMAGE_KEY = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){0,4}$/i;

export const websiteUrl = () => String(readSettings().website_url || config.websiteUrl || '').trim().replace(/\/+$/, '');

/** { key: url } for every replaced picture (absolute URLs for the public API). */
export function siteImageMap(absolute = true) {
  const rows = plainAll(db.prepare('SELECT key, file FROM site_images').all());
  return Object.fromEntries(rows.map((r) => [r.key, fileUrl(r.file, absolute)]));
}

/* ---------------------------------------------------------------- the website's list of pictures */

const CACHE_MS = 5 * 60 * 1000;
let cache = { url: null, at: 0, value: null };

async function readManifest(force = false) {
  const base = websiteUrl();
  if (!base) return { base: null, error: 'missing', images: [] };
  if (!isHttpUrl(base)) return { base, error: 'The website address in Website settings is not a valid link.', images: [] };
  const url = `${base}/site-images.json`;
  if (!force && cache.url === url && Date.now() - cache.at < CACHE_MS) return cache.value;

  let value;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (!res.ok) throw new Error(`the website answered with status ${res.status}`);
    const text = await res.text();
    if (text.length > 2_000_000) throw new Error('the list is too large');
    const json = JSON.parse(text);
    const images = (Array.isArray(json.images) ? json.images : [])
      .filter((i) => i && SITE_IMAGE_KEY.test(String(i.key)) && typeof i.src === 'string')
      .slice(0, 1000)
      .map((i) => {
        let src = null;
        try {
          const u = new URL(i.src, `${base}/`);
          if (u.protocol === 'https:' || u.protocol === 'http:') src = u.toString();
        } catch {
          /* skip */
        }
        return {
          key: String(i.key),
          default_url: src,
          label: String(i.label || i.key).slice(0, 200),
          pages: (Array.isArray(i.pages) ? i.pages : []).map((p) => String(p).slice(0, 60)).slice(0, 20),
          group: String(i.group || 'Other').slice(0, 60),
        };
      });
    value = { base, error: null, images };
    cache = { url, at: Date.now(), value };
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'the website took too long to answer' : err instanceof SyntaxError ? 'the list is not valid JSON' : err.message;
    value = { base, error: `Could not read ${url} (${why}).`, images: [] };
  }
  return value;
}

function itemFor(key, manifestItem, row) {
  return {
    key,
    label: manifestItem?.label || key,
    pages: manifestItem?.pages || [],
    group: manifestItem ? manifestItem.group : 'No longer on the website',
    default_url: manifestItem?.default_url || null,
    url: row ? fileUrl(row.file) : null,
    original_name: row?.original_name || null,
    updated_at: row?.updated_at || null,
    on_website: !!manifestItem,
  };
}

/* ---------------------------------------------------------------- admin routes */

export const siteImagesRouter = express.Router();

siteImagesRouter.get('/', async (req, res) => {
  const manifest = await readManifest(req.query.refresh === '1');
  const rows = new Map(plainAll(db.prepare('SELECT * FROM site_images').all()).map((r) => [r.key, r]));
  const items = manifest.images.map((m) => itemFor(m.key, m, rows.get(m.key)));
  const listed = new Set(items.map((i) => i.key));
  // replacements for pictures the website no longer uses (kept so they can be cleaned up)
  for (const [key, row] of rows) if (!listed.has(key)) items.push(itemFor(key, null, row));
  res.json({ website_url: manifest.base, error: manifest.error, items });
});

/** Replace a picture: multipart with `key` and `file`. */
siteImagesRouter.post('/replace', uploader({ file: 'image' }), (req, res) => {
  const key = String(req.body?.key || '').trim();
  const file = req.saved?.file?.[0];
  if (!SITE_IMAGE_KEY.test(key)) {
    cleanupRequestFiles(req);
    throw new HttpError(422, 'Unknown picture.', { key: 'invalid' });
  }
  if (!file) throw new HttpError(422, 'Choose an image to upload.', { file: 'required' });
  const old = plain(db.prepare('SELECT file FROM site_images WHERE key = ?').get(key));
  db.prepare(
    `INSERT INTO site_images (key, file, original_name, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET file = excluded.file, original_name = excluded.original_name,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(key, file, String(req.files.file[0].originalname || '').slice(0, 200), req.user?.id ?? null, nowIso());
  if (old?.file && old.file !== file) removeFile(old.file);
  const row = plain(db.prepare('SELECT * FROM site_images WHERE key = ?').get(key));
  res.json(itemFor(key, null, row));
});

/** Go back to the website's built-in picture: JSON { key }. */
siteImagesRouter.post('/reset', (req, res) => {
  const key = String(req.body?.key || '').trim();
  const row = plain(db.prepare('SELECT file FROM site_images WHERE key = ?').get(key));
  if (!row) throw new HttpError(404, 'This picture has not been replaced.');
  db.prepare('DELETE FROM site_images WHERE key = ?').run(key);
  removeFile(row.file);
  res.json({ ok: true });
});
