import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';
import { HttpError } from './util.js';

const KINDS = {
  image: {
    dir: 'images',
    ext: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'],
    mime: /^image\/(jpeg|png|webp|gif|avif)$/,
    mb: () => config.limits.imageMb,
    label: 'an image (JPG, PNG, WEBP, GIF or AVIF)',
  },
  video: {
    dir: 'videos',
    ext: ['.mp4', '.webm', '.mov', '.m4v', '.ogv'],
    mime: /^video\/(mp4|webm|quicktime|x-m4v|ogg)$/,
    mb: () => config.limits.videoMb,
    label: 'a video (MP4, WEBM, MOV, M4V or OGV)',
  },
  file: {
    dir: 'files',
    ext: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.jpg', '.jpeg', '.png', '.webp'],
    mime: /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-excel|vnd\.ms-powerpoint|octet-stream)|text\/plain|image\/(jpeg|png|webp))$/,
    mb: () => config.limits.fileMb,
    label: 'a document (PDF, Word, Excel, PowerPoint, TXT) or image',
  },
};

/**
 * Multer middleware for the given fields.
 * spec: { fieldName: 'image' | 'video' | 'file' | { kind, max } }
 * Saved files land in uploads/<kind>/<yyyy-mm>/<random>.<ext>; req.saved[field] holds
 * the relative paths.
 */
export function uploader(spec) {
  const fields = Object.entries(spec).map(([name, v]) => {
    const s = typeof v === 'string' ? { kind: v, max: 1 } : { max: 1, ...v };
    return { name, ...s };
  });
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  if (fields.length === 0) {
    // No files expected: still parse multipart text fields.
    const none = multer({ limits: { fields: 60, files: 0 } }).none();
    return (req, res, next) => {
      req.saved = {};
      if (!req.is('multipart/form-data')) return next();
      none(req, res, (err) => next(err && err instanceof multer.MulterError ? new HttpError(400, err.message) : err));
    };
  }
  const maxMb = Math.max(...fields.map((f) => KINDS[f.kind].mb()));

  const storage = multer.diskStorage({
    destination(_req, file, cb) {
      const kind = KINDS[byName[file.fieldname].kind];
      const month = new Date().toISOString().slice(0, 7);
      const dir = path.join(config.uploadDir, kind.dir, month);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      cb(null, `${crypto.randomBytes(12).toString('hex')}${path.extname(file.originalname).toLowerCase()}`);
    },
  });

  const mw = multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024, files: fields.reduce((a, f) => a + f.max, 0), fields: 60 },
    fileFilter(_req, file, cb) {
      const f = byName[file.fieldname];
      if (!f) return cb(new HttpError(400, `Unexpected file field "${file.fieldname}".`));
      const kind = KINDS[f.kind];
      const ext = path.extname(file.originalname).toLowerCase();
      if (!kind.ext.includes(ext) || !kind.mime.test(file.mimetype)) {
        return cb(new HttpError(400, `"${file.originalname}" must be ${kind.label}.`));
      }
      cb(null, true);
    },
  }).fields(fields.map((f) => ({ name: f.name, maxCount: f.max })));

  return (req, res, next) => {
    if (!req.is('multipart/form-data')) {
      req.saved = {};
      return next();
    }
    mw(req, res, (err) => {
      if (err) {
        cleanupRequestFiles(req);
        if (err instanceof multer.MulterError) {
          const msg =
            err.code === 'LIMIT_FILE_SIZE'
              ? `File is too large (max ${maxMb} MB).`
              : err.code === 'LIMIT_UNEXPECTED_FILE'
                ? `Too many files for "${err.field}".`
                : err.message;
          return next(new HttpError(400, msg));
        }
        return next(err);
      }
      // Enforce the per-kind size limit (multer only supports one global limit).
      for (const [name, list] of Object.entries(req.files || {})) {
        const kind = KINDS[byName[name].kind];
        const big = list.find((f) => f.size > kind.mb() * 1024 * 1024);
        if (big) {
          cleanupRequestFiles(req);
          return next(new HttpError(400, `"${big.originalname}" is too large (max ${kind.mb()} MB).`));
        }
      }
      req.saved = {};
      for (const [name, list] of Object.entries(req.files || {})) {
        req.saved[name] = list.map((f) => path.relative(config.uploadDir, f.path).split(path.sep).join('/'));
      }
      next();
    });
  };
}

export function cleanupRequestFiles(req) {
  for (const list of Object.values(req.files || {})) for (const f of list) removeFile(f.path, true);
}

/** Delete a stored upload. Accepts a relative path (as stored in the DB) or an absolute one. */
export function removeFile(p, absolute = false) {
  if (!p || /^https?:\/\//.test(p)) return;
  const full = absolute ? p : path.join(config.uploadDir, p);
  if (!path.resolve(full).startsWith(path.resolve(config.uploadDir) + path.sep)) return;
  fs.rm(full, { force: true }, () => {});
}
