import express from 'express';
import path from 'node:path';
import { db, tx, plainAll } from '../db.js';
import { crudRouter, parseBody, insertRow, getRow, uniqueValue } from '../crud.js';
import { uploader, cleanupRequestFiles } from '../upload.js';
import { HttpError, nowIso, slugify, embedUrl, linkThumbnail, fileUrl } from '../util.js';

const STATUS = ['draft', 'published'];

/* ---------------------------------------------------------------- shared helpers */

export function eventState(e, now = nowIso()) {
  if (e.status === 'cancelled') return 'cancelled';
  if (e.is_live) return 'live';
  if (e.start_at > now) return 'upcoming';
  if (e.end_at && e.end_at > now) return 'live';
  return 'past';
}

/** SQL filter for ?when=live|upcoming|past on the events table. */
export function eventWhen(when, where, params) {
  const now = nowIso();
  if (when === 'live') {
    where.push(`status <> 'cancelled' AND (is_live = 1 OR (start_at <= ? AND end_at > ?))`);
    params.push(now, now);
  } else if (when === 'upcoming') {
    where.push('is_live = 0 AND start_at > ?');
    params.push(now);
  } else if (when === 'past') {
    where.push('is_live = 0 AND COALESCE(end_at, start_at) <= ?');
    params.push(now);
  }
}

export function noticeActive(n, now = nowIso()) {
  return n.status === 'published' && (!n.publish_at || n.publish_at <= now) && (!n.expires_at || n.expires_at > now);
}

/* ---------------------------------------------------------------- definitions */

export const postFields = [
  { name: 'title', type: 'text', required: true, max: 200, label: 'Title' },
  { name: 'slug', type: 'text', max: 100, label: 'Slug' },
  { name: 'category', type: 'text', max: 60, label: 'Category' },
  { name: 'excerpt', type: 'longtext', max: 600, label: 'Summary' },
  { name: 'content', type: 'html', label: 'Content' },
  { name: 'status', type: 'enum', values: STATUS, label: 'Status' },
  { name: 'published_at', type: 'datetime', label: 'Publish date' },
];

const posts = crudRouter({
  table: 'posts',
  fields: postFields,
  files: { cover_image: 'image' },
  search: ['title', 'excerpt', 'category'],
  filters: ['status', 'category'],
  sort: 'COALESCE(published_at, created_at) DESC',
  prepare(data, { existing }) {
    if ('slug' in data || !existing) {
      const base = slugify(data.slug || data.title || existing?.title);
      data.slug = uniqueValue('posts', 'slug', base, existing?.id);
    }
    const status = data.status ?? existing?.status;
    if (status === 'published' && !('published_at' in data ? data.published_at : existing?.published_at)) {
      data.published_at = nowIso();
    }
  },
});

const galleryFields = [
  { name: 'title', type: 'text', max: 200, label: 'Title' },
  { name: 'caption', type: 'longtext', max: 1000, label: 'Caption' },
  { name: 'album', type: 'text', max: 80, label: 'Album' },
  { name: 'is_featured', type: 'bool' },
  { name: 'status', type: 'enum', values: STATUS, label: 'Status' },
];

const galleryCrud = crudRouter({
  table: 'gallery',
  fields: galleryFields,
  files: { file: 'image' },
  search: ['title', 'caption', 'album'],
  filters: ['status', 'is_featured'],
  where(q, where, params) {
    if (q.album === '__none') where.push(`(album IS NULL OR album = '')`);
    else if (q.album) {
      where.push('album = ?');
      params.push(String(q.album));
    }
  },
});

const gallery = express.Router();

gallery.get('/albums', (_req, res) => {
  const rows = plainAll(
    db
      .prepare(
        `SELECT COALESCE(album, '') AS album, COUNT(*) AS count, MAX(created_at) AS updated_at
         FROM gallery GROUP BY COALESCE(album, '') ORDER BY updated_at DESC`,
      )
      .all(),
  );
  res.json({ items: rows });
});

// Multi-image upload: one row per file, sharing album/caption/status.
gallery.post('/', uploader({ files: { kind: 'image', max: 50 } }), (req, res) => {
  try {
    const files = req.files?.files || [];
    if (!files.length) throw new HttpError(422, 'Choose at least one image to upload.');
    const data = parseBody(galleryFields, req.body, { partial: true });
    const now = nowIso();
    const ids = tx(() =>
      files.map((f, i) =>
        insertRow('gallery', {
          ...data,
          title: data.title || path.parse(f.originalname).name.replace(/[_-]+/g, ' ').slice(0, 200),
          file: req.saved.files[i],
          created_at: now,
          updated_at: now,
        }),
      ),
    );
    res.status(201).json({ items: ids.map((id) => galleryCrud.serialize(getRow('gallery', id))) });
  } catch (err) {
    cleanupRequestFiles(req);
    throw err;
  }
});

gallery.use(galleryCrud);

const videos = crudRouter({
  table: 'videos',
  fields: [
    { name: 'title', type: 'text', required: true, max: 200, label: 'Title' },
    { name: 'description', type: 'longtext', max: 5000, label: 'Description' },
    { name: 'category', type: 'text', max: 60, label: 'Category' },
    { name: 'source', type: 'enum', values: ['upload', 'link'], required: true, label: 'Source' },
    { name: 'url', type: 'url', label: 'Video link' },
    { name: 'is_featured', type: 'bool' },
    { name: 'status', type: 'enum', values: STATUS, label: 'Status' },
  ],
  files: { file: 'video', thumbnail: 'image' },
  search: ['title', 'description', 'category'],
  filters: ['status', 'category', 'source'],
  prepare(data, { existing, removeLater }) {
    const source = data.source ?? existing?.source;
    if (source === 'link') {
      const url = 'url' in data ? data.url : existing?.url;
      if (!url) throw new HttpError(422, 'Paste the video link (YouTube, Vimeo, Facebook or a direct MP4 link).', { url: 'required' });
      // A link-type video keeps no uploaded file (old or just uploaded).
      if (data.file) removeLater.push(data.file);
      if (existing?.file) removeLater.push(existing.file);
      data.file = null;
    } else {
      const file = 'file' in data ? data.file : existing?.file;
      if (!file) throw new HttpError(422, 'Choose a video file to upload.', { file: 'required' });
      data.url = null;
    }
  },
  serialize(v) {
    v.embed_url = v.source === 'link' ? embedUrl(v.url) : null;
    v.thumbnail_url = v.thumbnail_url || (v.source === 'link' ? linkThumbnail(v.url) : null);
    return v;
  },
});

const events = crudRouter({
  table: 'events',
  fields: [
    { name: 'title', type: 'text', required: true, max: 200, label: 'Title' },
    { name: 'description', type: 'longtext', max: 10000, label: 'Description' },
    { name: 'venue', type: 'text', max: 200, label: 'Venue' },
    { name: 'start_at', type: 'datetime', required: true, label: 'Start date/time' },
    { name: 'end_at', type: 'datetime', label: 'End date/time' },
    { name: 'live_url', type: 'url', label: 'Live stream link' },
    { name: 'is_live', type: 'bool' },
    { name: 'status', type: 'enum', values: ['draft', 'published', 'cancelled'], label: 'Status' },
  ],
  files: { cover_image: 'image' },
  search: ['title', 'venue', 'description'],
  filters: ['status'],
  sort: 'start_at DESC',
  where: (q, where, params) => eventWhen(q.when, where, params),
  prepare(data, { existing }) {
    const start = data.start_at ?? existing?.start_at;
    const end = 'end_at' in data ? data.end_at : existing?.end_at;
    if (start && end && end < start) throw new HttpError(422, 'End time must be after the start time.', { end_at: 'invalid' });
  },
  serialize(e) {
    e.state = eventState(e);
    e.live_embed_url = embedUrl(e.live_url);
    return e;
  },
});

const notices = crudRouter({
  table: 'notices',
  fields: [
    { name: 'title', type: 'text', required: true, max: 250, label: 'Title' },
    { name: 'body', type: 'longtext', max: 20000, label: 'Details' },
    { name: 'category', type: 'text', max: 60, label: 'Category' },
    { name: 'priority', type: 'enum', values: ['normal', 'important', 'urgent'], label: 'Priority' },
    { name: 'is_pinned', type: 'bool' },
    { name: 'show_in_ticker', type: 'bool' },
    { name: 'publish_at', type: 'datetime', label: 'Show from' },
    { name: 'expires_at', type: 'datetime', label: 'Hide after' },
    { name: 'status', type: 'enum', values: STATUS, label: 'Status' },
  ],
  files: { attachment: 'file' },
  search: ['title', 'body', 'category'],
  filters: ['status', 'category', 'priority'],
  sort: 'is_pinned DESC, created_at DESC',
  prepare(data, { existing, req }) {
    const f = req.files?.attachment?.[0];
    if (f) data.attachment_name = f.originalname.slice(0, 200);
    else if (data.attachment === null) data.attachment_name = null;
    const from = 'publish_at' in data ? data.publish_at : existing?.publish_at;
    const to = 'expires_at' in data ? data.expires_at : existing?.expires_at;
    if (from && to && to <= from) throw new HttpError(422, '"Hide after" must be later than "Show from".', { expires_at: 'invalid' });
  },
  serialize(n) {
    n.is_active = noticeActive(n);
    return n;
  },
});

/* ---------------------------------------------------------------- router */

export const contentRouter = express.Router();
contentRouter.use('/posts', posts);
contentRouter.use('/gallery', gallery);
contentRouter.use('/videos', videos);
contentRouter.use('/events', events);
contentRouter.use('/notices', notices);

// Image upload for the rich-text editor (inline images inside posts).
contentRouter.post('/uploads/image', uploader({ file: 'image' }), (req, res) => {
  const p = req.saved?.file?.[0];
  if (!p) throw new HttpError(422, 'Choose an image.');
  res.status(201).json({ url: fileUrl(p) });
});

// Distinct values for autocomplete (categories, albums, classes).
const OPTION_FIELDS = {
  posts: ['category'],
  gallery: ['album'],
  videos: ['category'],
  notices: ['category'],
  enquiries: ['class_applying'],
};
contentRouter.get('/options/:table/:field', (req, res) => {
  const { table, field } = req.params;
  if (!OPTION_FIELDS[table]?.includes(field)) throw new HttpError(404, 'Unknown option list.');
  const rows = db
    .prepare(`SELECT DISTINCT ${field} AS v FROM ${table} WHERE ${field} IS NOT NULL AND ${field} <> '' ORDER BY ${field} LIMIT 200`)
    .all();
  res.json({ items: rows.map((r) => r.v) });
});
