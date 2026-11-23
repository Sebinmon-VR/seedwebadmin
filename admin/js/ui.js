/* Small DOM + UI toolkit for the admin panel (no framework). */

/** Create an element. attrs: class, style (string), dataset, on<Event> handlers, html (trusted), any attribute. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------ icons */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  pin: '<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  mappin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5H3v7h4c0 3-2 5-4 5zM14 21c3 0 7-1 7-8V5h-7v7h4c0 3-2 5-4 5z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || ICONS.alert;
  return s;
}

/* ------------------------------------------------------------------ formatting */
const pad = (n) => String(n).padStart(2, '0');

export const fmt = {
  date(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  },
  dateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  },
  time(iso) {
    return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  },
  relative(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const units = [
      [60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [2629800, 'week', 604800],
      [31557600, 'month', 2629800], [Infinity, 'year', 31557600],
    ];
    for (const [limit, unit, div] of units) if (abs < limit) return rtf.format(-Math.round(diff / div), unit);
    return fmt.date(iso);
  },
  /** ISO -> value for <input type="datetime-local"> in the browser's timezone. */
  toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },
  fromLocalInput(v) {
    return v ? new Date(v).toISOString() : '';
  },
  bytes(n) {
    if (!n && n !== 0) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  },
  initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  },
};

export const badge = (text, tone = '') => h('span', { class: `badge ${tone}` }, text);

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* ------------------------------------------------------------------ toast */
let toastHost;
export function toast(message, type = 'ok') {
  toastHost ||= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast ${type === 'error' ? 'error' : ''}` }, icon(type === 'error' ? 'alert' : 'check'), h('span', message));
  toastHost.append(el);
  while (toastHost.childElementCount > 3) toastHost.firstChild.remove();
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }, type === 'error' ? 5000 : 2800);
}

/* ------------------------------------------------------------------ overlay layers */
const layers = [];

function openLayer(panel, { onClose } = {}) {
  const overlay = h('div', { class: 'overlay' });
  document.body.append(overlay, panel);
  const prevFocus = document.activeElement;
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    panel.classList.add('open');
  });
  let closed = false;
  const layer = {
    close() {
      if (closed) return;
      closed = true;
      overlay.classList.remove('open');
      panel.classList.remove('open');
      setTimeout(() => {
        overlay.remove();
        panel.remove();
      }, 220);
      layers.splice(layers.indexOf(layer), 1);
      if (!layers.length) document.body.style.overflow = '';
      prevFocus?.focus?.();
      onClose?.();
    },
    canClose: () => true,
  };
  overlay.addEventListener('click', () => layer.canClose() && layer.close());
  layers.push(layer);
  document.body.style.overflow = 'hidden';
  return layer;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && layers.length) {
    const top = layers[layers.length - 1];
    if (top.canClose()) top.close();
  }
});

/** Slide-in side panel. Returns { el, body, foot, close, setTitle }. */
export function drawer({ title, wide = false, onClose } = {}) {
  const titleEl = h('h2', title);
  const closeBtn = h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Close' }, icon('x'));
  const body = h('div', { class: 'drawer-body' });
  const foot = h('div', { class: 'drawer-foot' });
  const el = h('aside', { class: `drawer ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'drawer-head' }, titleEl, closeBtn), body, foot);
  const layer = openLayer(el, { onClose });
  closeBtn.addEventListener('click', () => layer.canClose() && layer.close());
  return { el, body, foot, close: layer.close, layer, setTitle: (t) => (titleEl.textContent = t) };
}

/** Centered dialog. Returns { el, close }. */
export function modal({ content, className = '' }) {
  const el = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const layer = openLayer(el);
  return { el, close: layer.close };
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button' }, confirmText);
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const m = modal({
      content: [h('div', { class: 'modal-body' }, h('h3', title), message && h('p', message)), h('div', { class: 'modal-foot' }, cancel, ok)],
    });
    const layer = layers[layers.length - 1];
    const prev = layer.close;
    layer.close = () => {
      prev();
      resolve(result);
    };
    ok.addEventListener('click', () => {
      result = true;
      layer.close();
    });
    cancel.addEventListener('click', () => layer.close());
    setTimeout(() => ok.focus(), 50);
    void m;
  });
}

/** Full-size preview for an image, video file or embeddable link. */
export function lightbox({ image, video, embed }) {
  const content = image ? h('img', { src: image, alt: '' }) : video ? h('video', { src: video, controls: true, autoplay: true }) : h('iframe', { src: embed, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true });
  modal({ content: h('div', { class: 'lightbox' }, content), className: 'lg' });
}

/* ------------------------------------------------------------------ misc widgets */
export const spinner = () => h('div', { class: 'loading-block' }, h('div', { class: 'spinner' }));

export function emptyState({ iconName = 'inbox', title, text, action }) {
  return h('div', { class: 'empty' }, h('span', { class: 'big' }, icon(iconName)), h('h3', title), text && h('p', text), action);
}

export function pager({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(total, page * limit);
  return h(
    'div',
    { class: 'pager' },
    h('span', total ? `Showing ${from}–${to} of ${total}` : 'No results'),
    pages > 1 &&
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'btn btn-sm', disabled: page <= 1, onclick: () => onPage(page - 1) }, 'Previous'),
        h('span', { class: 'btn btn-sm btn-ghost', style: 'pointer-events:none' }, `${page} / ${pages}`),
        h('button', { class: 'btn btn-sm', disabled: page >= pages, onclick: () => onPage(page + 1) }, 'Next'),
      ),
  );
}

export function setLoading(btn, on) {
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Could not copy — select and copy manually.', 'error');
  }
}
