import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'cms.sqlite'));

const JOURNAL = ['WAL', 'DELETE', 'TRUNCATE', 'PERSIST'].includes(config.sqliteJournalMode) ? config.sqliteJournalMode : 'WAL';
db.exec(`PRAGMA journal_mode = ${JOURNAL}; PRAGMA busy_timeout = 5000;`);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    slug         TEXT NOT NULL UNIQUE,
    category     TEXT,
    excerpt      TEXT,
    content      TEXT,
    cover_image  TEXT,
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    published_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS gallery (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT,
    caption     TEXT,
    album       TEXT,
    file        TEXT NOT NULL,
    is_featured INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS videos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    category    TEXT,
    source      TEXT NOT NULL CHECK (source IN ('upload','link')),
    file        TEXT,
    url         TEXT,
    thumbnail   TEXT,
    is_featured INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    venue       TEXT,
    start_at    TEXT NOT NULL,
    end_at      TEXT,
    cover_image TEXT,
    live_url    TEXT,
    is_live     INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','cancelled')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS notices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    body         TEXT,
    category     TEXT,
    priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
    attachment   TEXT,
    attachment_name TEXT,
    is_pinned    INTEGER NOT NULL DEFAULT 0,
    show_in_ticker INTEGER NOT NULL DEFAULT 0,
    publish_at   TEXT,
    expires_at   TEXT,
    status       TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published')),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name     TEXT NOT NULL,
    parent_name      TEXT,
    phone            TEXT NOT NULL,
    email            TEXT,
    class_applying   TEXT,
    date_of_birth    TEXT,
    previous_school  TEXT,
    message          TEXT,
    source           TEXT,
    status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','contacted','visited','enrolled','closed')),
    notes            TEXT,
    ip               TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_posts_status    ON posts(status, published_at);
  CREATE INDEX IF NOT EXISTS idx_gallery_album   ON gallery(album);
  CREATE INDEX IF NOT EXISTS idx_events_start    ON events(start_at);
  CREATE INDEX IF NOT EXISTS idx_notices_publish ON notices(status, publish_at);
  CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status, created_at);
`);

/** Run fn inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Convert null-prototype rows from node:sqlite into plain objects. */
export const plain = (row) => (row ? { ...row } : row);
export const plainAll = (rows) => rows.map((r) => ({ ...r }));
