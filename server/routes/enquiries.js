import express from 'express';
import { db, plainAll } from '../db.js';
import { parseBody, insertRow, updateRow, getRow } from '../crud.js';
import { uploader } from '../upload.js';
import { HttpError, nowIso, pageParams, likeTerm, csvEscape } from '../util.js';

export const ENQUIRY_STATUSES = ['new', 'contacted', 'visited', 'enrolled', 'closed'];

/** Fields an applicant fills in on the website form. */
export const enquiryFields = [
  { name: 'student_name', type: 'text', required: true, max: 120, label: 'Student name' },
  { name: 'parent_name', type: 'text', max: 120, label: 'Parent / guardian name' },
  { name: 'phone', type: 'text', required: true, max: 30, label: 'Phone' },
  { name: 'email', type: 'email', max: 160, label: 'Email' },
  { name: 'class_applying', type: 'text', max: 60, label: 'Class / course' },
  { name: 'date_of_birth', type: 'date', label: 'Date of birth' },
  { name: 'previous_school', type: 'text', max: 200, label: 'Previous school' },
  { name: 'message', type: 'longtext', max: 3000, label: 'Message' },
  { name: 'source', type: 'text', max: 60, label: 'Source' },
];

function checkPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!/^[+\d\s()-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    throw new HttpError(422, 'Please enter a valid phone number.', { phone: 'invalid' });
  }
}

/** Validate + store a new enquiry. Used by the public form and by admins adding walk-ins. */
export function createEnquiry(body, { ip, defaultSource }) {
  const data = parseBody(enquiryFields, body, { partial: false });
  checkPhone(data.phone);
  const now = nowIso();
  const id = insertRow('enquiries', {
    ...data,
    source: data.source || defaultSource,
    status: 'new',
    ip: ip || null,
    created_at: now,
    updated_at: now,
  });
  return getRow('enquiries', id);
}

function listFilters(query) {
  const where = [];
  const params = [];
  if (ENQUIRY_STATUSES.includes(query.status)) {
    where.push('status = ?');
    params.push(query.status);
  }
  if (query.class_applying) {
    where.push('class_applying = ?');
    params.push(String(query.class_applying));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) {
    where.push('created_at >= ?');
    params.push(new Date(`${query.from}T00:00:00`).toISOString());
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) {
    where.push('created_at < ?');
    const end = new Date(`${query.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    params.push(end.toISOString());
  }
  const q = String(query.q || '').trim();
  if (q) {
    const cols = ['student_name', 'parent_name', 'phone', 'email', 'class_applying', 'message'];
    where.push(`(${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    params.push(...cols.map(() => likeTerm(q)));
  }
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export const enquiriesRouter = express.Router();

enquiriesRouter.get('/stats', (_req, res) => {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status').all();
  const out = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const r of rows) {
    out[r.status] = r.n;
    total += r.n;
  }
  res.json({ ...out, total });
});

enquiriesRouter.get('/export.csv', (req, res) => {
  const { w, params } = listFilters(req.query);
  const rows = plainAll(db.prepare(`SELECT * FROM enquiries ${w} ORDER BY created_at DESC`).all(...params));
  const cols = [
    ['id', 'ID'],
    ['created_at', 'Received (UTC)'],
    ['status', 'Status'],
    ['student_name', 'Student name'],
    ['parent_name', 'Parent / guardian'],
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['class_applying', 'Class / course'],
    ['date_of_birth', 'Date of birth'],
    ['previous_school', 'Previous school'],
    ['message', 'Message'],
    ['source', 'Source'],
    ['notes', 'Internal notes'],
  ];
  const lines = [cols.map((c) => c[1]).join(',')];
  for (const r of rows) lines.push(cols.map(([k]) => csvEscape(r[k])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="admission-enquiries-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${lines.join('\r\n')}\r\n`);
});

enquiriesRouter.get('/', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const { w, params } = listFilters(req.query);
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM enquiries ${w}`).get(...params);
  const items = plainAll(
    db.prepare(`SELECT * FROM enquiries ${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset),
  );
  res.json({ items, total, page, limit });
});

enquiriesRouter.get('/:id', (req, res) => {
  const row = getRow('enquiries', req.params.id);
  if (!row) throw new HttpError(404, 'Enquiry not found.');
  res.json(row);
});

// Admin-entered enquiry (phone call, walk-in, etc.)
enquiriesRouter.post('/', uploader({}), (req, res) => {
  res.status(201).json(createEnquiry(req.body, { defaultSource: 'office' }));
});

enquiriesRouter.patch('/:id', (req, res) => {
  const row = getRow('enquiries', req.params.id);
  if (!row) throw new HttpError(404, 'Enquiry not found.');
  const data = parseBody(
    [
      { name: 'status', type: 'enum', values: ENQUIRY_STATUSES, label: 'Status' },
      { name: 'notes', type: 'longtext', max: 10000, label: 'Notes' },
      ...enquiryFields,
    ],
    req.body,
    { partial: true },
  );
  if ('phone' in data) checkPhone(data.phone);
  data.updated_at = nowIso();
  updateRow('enquiries', row.id, data);
  res.json(getRow('enquiries', row.id));
});

enquiriesRouter.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM enquiries WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) throw new HttpError(404, 'Enquiry not found.');
  res.json({ ok: true });
});

enquiriesRouter.post('/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger).slice(0, 500) : [];
  const stmt = db.prepare('DELETE FROM enquiries WHERE id = ?');
  let deleted = 0;
  for (const id of ids) deleted += Number(stmt.run(id).changes);
  res.json({ ok: true, deleted });
});
