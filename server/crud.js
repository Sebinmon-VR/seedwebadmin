import express from 'express';
import { db, plain, plainAll } from './db.js';
import { uploader, cleanupRequestFiles, removeFile } from './upload.js';
import { HttpError, nowIso, pageParams, likeTerm, isHttpUrl, cleanHtml, fileUrl } from './util.js';

const MAX = { text: 300, longtext: 20000, html: 300000, url: 1000 };

export const truthy = (v) => v === true || v === 1 || ['1', 'true', 'on', 'yes'].includes(String(v).toLowerCase());

/**
 * Validate and coerce request body values against field definitions.
 * Only fields present in the body are returned, so the same function serves
 * create (with required checks) and partial updates.
 */
export function parseBody(fields, body = {}, { partial }) {
  const data = {};
  const errors = {};
  for (const f of fields) {
    const has = Object.prototype.hasOwnProperty.call(body, f.name);
    if (!has) {
      if (!partial && f.required) errors[f.name] = `${f.label || f.name} is required.`;
      continue;
    }
    let v = body[f.name];
    if (Array.isArray(v)) v = v[v.length - 1];
    if (typeof v === 'string') v = v.trim();
    const empty = v === '' || v === null || v === undefined;

    if (f.type === 'bool') {
      data[f.name] = truthy(v) ? 1 : 0;
      continue;
    }
    if (empty) {
      if (f.required) errors[f.name] = `${f.label || f.name} is required.`;
      else data[f.name] = null;
      continue;
    }
    v = String(v);
    const label = f.label || f.name;
    switch (f.type) {
      case 'enum':
        if (!f.values.includes(v)) errors[f.name] = `${label} must be one of: ${f.values.join(', ')}.`;
        break;
      case 'datetime': {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) errors[f.name] = `${label} is not a valid date/time.`;
        else v = d.toISOString();
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v).getTime())) errors[f.name] = `${label} must be a date (YYYY-MM-DD).`;
        break;
      case 'url':
        if (!isHttpUrl(v)) errors[f.name] = `${label} must be a full link starting with http:// or https://.`;
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.name] = `${label} must be a valid email address.`;
        break;
      case 'html':
        v = cleanHtml(v);
        break;
    }
    const max = f.max || MAX[f.type] || MAX.text;
    if (v.length > max) errors[f.name] = `${label} is too long (max ${max} characters).`;
    data[f.name] = v;
  }
  if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors)[0], errors);
  return data;
}

/** Make `base` unique in table.column, ignoring row `exceptId`. */
export function uniqueValue(table, column, base, exceptId) {
  let candidate = base;
  for (let i = 2; ; i++) {
    const hit = db.prepare(`SELECT id FROM ${table} WHERE ${column} = ? AND id <> ?`).get(candidate, exceptId ?? -1);
    if (!hit) return candidate;
    candidate = `${base}-${i}`;
  }
}

export function insertRow(table, data) {
  const keys = Object.keys(data);
  const info = db
    .prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => data[k]));
  return Number(info.lastInsertRowid);
}

export function updateRow(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => data[k]), id);
}

export const getRow = (table, id) => plain(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)));

/**
 * Build an admin REST router for a table:
 *   GET / (list with ?q, filters, ?sort=col:asc|desc, ?page, ?limit)
 *   GET /:id, POST /, PUT|PATCH /:id, DELETE /:id, POST /bulk-delete
 *
 * def: {
 *   table, fields: [{ name, type, required, values, max, label }],
 *   files: { column: 'image' | 'video' | 'file' },
 *   search: [columns], filters: [columns], sort: 'col DESC',
 *   where(query, where, params)       extra list filters
 *   prepare(data, ctx)                ctx = { existing, req, removeLater: [] }
 *   serialize(row)                    extra output fields
 * }
 */
export function crudRouter(def) {
  const router = express.Router();
  const fileCols = Object.keys(def.files || {});
  const upload = uploader(def.files || {});
  const sortable = new Set(['id', 'created_at', 'updated_at', ...def.fields.map((f) => f.name)]);

  const serialize = (row) => {
    if (!row) return row;
    const out = { ...row };
    for (const c of fileCols) out[`${c}_url`] = fileUrl(row[c]);
    return def.serialize ? def.serialize(out) : out;
  };

  router.get('/', (req, res) => {
    const { page, limit, offset } = pageParams(req.query);
    const where = [];
    const params = [];
    const q = String(req.query.q || '').trim();
    if (q && def.search?.length) {
      where.push(`(${def.search.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      params.push(...def.search.map(() => likeTerm(q)));
    }
    for (const f of def.filters || []) {
      if (req.query[f] !== undefined && req.query[f] !== '') {
        where.push(`${f} = ?`);
        params.push(String(req.query[f]));
      }
    }
    def.where?.(req.query, where, params);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let order = def.sort || 'created_at DESC';
    const [sc, sd] = String(req.query.sort || '').split(':');
    if (sortable.has(sc)) order = `${sc} ${sd === 'asc' ? 'ASC' : 'DESC'}`;

    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${def.table} ${w}`).get(...params);
    const items = plainAll(
      db.prepare(`SELECT * FROM ${def.table} ${w} ORDER BY ${order}, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset),
    );
    res.json({ items: items.map(serialize), total, page, limit });
  });

  router.get('/:id', (req, res) => {
    const row = getRow(def.table, req.params.id);
    if (!row) throw new HttpError(404, 'Not found.');
    res.json(serialize(row));
  });

  const save = (isCreate) => (req, res) => {
    const removeLater = [];
    try {
      const existing = isCreate ? null : getRow(def.table, req.params.id);
      if (!isCreate && !existing) throw new HttpError(404, 'Not found.');
      const data = parseBody(def.fields, req.body, { partial: !isCreate });

      for (const c of fileCols) {
        const uploaded = req.saved?.[c]?.[0];
        if (uploaded) {
          data[c] = uploaded;
          if (existing?.[c]) removeLater.push(existing[c]);
        } else if (existing && truthy(req.body?.[`remove_${c}`])) {
          data[c] = null;
          if (existing[c]) removeLater.push(existing[c]);
        }
      }

      def.prepare?.(data, { existing, req, removeLater });
      data.updated_at = nowIso();

      let id;
      if (isCreate) {
        data.created_at = data.updated_at;
        id = insertRow(def.table, data);
      } else {
        id = existing.id;
        updateRow(def.table, id, data);
      }
      removeLater.forEach((p) => removeFile(p));
      res.status(isCreate ? 201 : 200).json(serialize(getRow(def.table, id)));
    } catch (err) {
      cleanupRequestFiles(req);
      throw err;
    }
  };

  router.post('/', upload, save(true));
  router.put('/:id', upload, save(false));
  router.patch('/:id', upload, save(false));

  const destroy = (row) => {
    db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(row.id);
    for (const c of fileCols) removeFile(row[c]);
  };

  router.delete('/:id', (req, res) => {
    const row = getRow(def.table, req.params.id);
    if (!row) throw new HttpError(404, 'Not found.');
    destroy(row);
    res.json({ ok: true });
  });

  router.post('/bulk-delete', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger).slice(0, 500) : [];
    let deleted = 0;
    for (const id of ids) {
      const row = getRow(def.table, id);
      if (row) {
        destroy(row);
        deleted++;
      }
    }
    res.json({ ok: true, deleted });
  });

  router.serialize = serialize;
  return router;
}
