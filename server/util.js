import sanitize from 'sanitize-html';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const nowIso = () => new Date().toISOString();

/** Visitor IP. Azure's front end can append ":port" to IPv4 addresses in X-Forwarded-For. */
export function clientIp(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '');
  const m = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return m ? m[1] : ip;
}

export function slugify(s) {
  return (
    String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item'
  );
}

export function pageParams(query, maxLimit = 100) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

/** Escape LIKE wildcards so user search text is matched literally. */
export const likeTerm = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Build an embeddable player URL for common video hosts (YouTube, Vimeo, Facebook). */
export function embedUrl(url) {
  if (!url || !isHttpUrl(url)) return null;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1).split('/')[0]}`;
  if (host.endsWith('youtube.com')) {
    if (u.searchParams.get('v')) return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
    const m = u.pathname.match(/^\/(?:embed|live|shorts)\/([\w-]+)/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
  }
  if (host === 'vimeo.com') {
    const m = u.pathname.match(/^\/(\d+)/);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
  }
  if (host === 'player.vimeo.com') return url;
  if (host.endsWith('facebook.com') || host === 'fb.watch') {
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false`;
  }
  return null;
}

/** YouTube thumbnail for a link, used when no custom thumbnail was uploaded. */
export function linkThumbnail(url) {
  const e = embedUrl(url);
  const m = e && e.match(/youtube\.com\/embed\/([\w-]+)/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}

const HTML_OPTIONS = {
  allowedTags: [
    'p', 'br', 'hr', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote',
    'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'pre', 'code', 'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tag, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}) },
    }),
  },
};

/**
 * Clean rich-text HTML coming from the editor. Links to our own uploads are stored as
 * relative /uploads/... paths so changing PUBLIC_BASE_URL later doesn't break old posts.
 */
export function cleanHtml(html) {
  if (!html) return '';
  const own = config.publicBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rel = String(html).replace(new RegExp(`(src|href)="${own}/uploads/`, 'g'), '$1="/uploads/');
  return sanitize(rel, HTML_OPTIONS);
}

/** Rewrite relative /uploads/ references to absolute URLs for consumers on other domains. */
export const absolutizeHtml = (html) =>
  html ? html.replace(/(src|href)="\/uploads\//g, `$1="${config.publicBaseUrl}/uploads/`) : html;

/** Turn a stored relative upload path into a URL. */
export const fileUrl = (p, absolute = false) =>
  p ? (/^https?:\/\//.test(p) ? p : `${absolute ? config.publicBaseUrl : ''}/uploads/${p}`) : null;

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection (but leave phone numbers like +91 98765 43210 alone).
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
