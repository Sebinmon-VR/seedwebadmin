import { h, icon, fmt, toast, setLoading } from './ui.js';
import { api } from './api.js';
import { limits } from './forms.js';
import { dashboard } from './pages/dashboard.js';
import { posts, videos, events, notices } from './pages/content.js';
import { gallery } from './pages/gallery.js';
import { enquiries } from './pages/enquiries.js';
import { settings, account, admins, integration } from './pages/settings.js';

const NAV = [
  { items: [{ path: 'dashboard', label: 'Dashboard', icon: 'grid', page: dashboard }] },
  {
    label: 'Content',
    items: [
      { path: 'posts', label: 'Posts', icon: 'file', page: posts },
      { path: 'gallery', label: 'Photo gallery', icon: 'image', page: gallery },
      { path: 'videos', label: 'Videos', icon: 'video', page: videos },
      { path: 'events', label: 'Events & live', icon: 'calendar', page: events },
      { path: 'notices', label: 'Notices', icon: 'megaphone', page: notices },
    ],
  },
  { label: 'Admissions', items: [{ path: 'enquiries', label: 'Enquiries', icon: 'inbox', page: enquiries, countKey: 'enquiries' }] },
  {
    label: 'Manage',
    items: [
      { path: 'settings', label: 'Website settings', icon: 'sliders', page: settings },
      { path: 'integration', label: 'Website API', icon: 'code', page: integration },
      { path: 'admins', label: 'Admins', icon: 'users', page: admins },
    ],
  },
];
const HIDDEN = [{ path: 'account', label: 'My account', page: account }];
const ROUTES = Object.fromEntries([...NAV.flatMap((s) => s.items), ...HIDDEN].map((r) => [r.path, r]));

const root = document.getElementById('root');
const app = { user: null, meta: null, brand: { site_name: '', site_logo_url: null } };
let shell = null;
let countTimer = null;

/* ------------------------------------------------------------------ boot */

async function boot() {
  try {
    const { user } = await api('/api/auth/me');
    app.user = user;
  } catch {
    return renderLogin();
  }
  try {
    app.meta = await api('/api/admin/meta');
    Object.assign(limits, app.meta.limits);
  } catch {
    app.meta = { publicBaseUrl: location.origin, allowedOrigins: [], limits };
  }
  await loadBrand();
  renderShell();
  route();
}

async function loadBrand() {
  try {
    const s = await api('/api/admin/settings');
    app.brand = { site_name: s.site_name, site_logo_url: s.site_logo_url };
  } catch {
    /* keep defaults */
  }
}

window.addEventListener('auth:expired', () => {
  if (!app.user) return;
  app.user = null;
  renderLogin('Your session has expired. Please sign in again.');
});

/* ------------------------------------------------------------------ login */

function brandBlock(dark = true) {
  const mark = h('div', { class: 'brand-mark' }, app.brand.site_logo_url ? h('img', { src: app.brand.site_logo_url, alt: '' }) : icon('leaf'));
  return h('div', { class: 'brand' }, mark, h('div', { style: 'min-width:0' }, h('div', { class: 'brand-name truncate' }, app.brand.site_name || 'Control Panel'), h('div', { class: 'brand-sub' }, dark ? 'Website control panel' : 'Sign in to manage your website')));
}

function renderLogin(message) {
  shell = null;
  clearInterval(countTimer);
  document.title = 'Sign in · Control Panel';
  const err = h('div', { class: 'alert', hidden: !message, role: 'alert' }, message || '');
  const email = h('input', { class: 'input', type: 'email', id: 'email', autocomplete: 'username', required: true });
  const password = h('input', { class: 'input', type: 'password', id: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit', style: 'height:40px' }, 'Sign in');
  const form = h(
    'form',
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), password),
    err,
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    setLoading(btn, true);
    try {
      await api('/api/auth/login', { method: 'POST', body: { email: email.value.trim(), password: password.value } });
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      setLoading(btn, false);
      password.select();
    }
  });
  root.replaceChildren(
    h('div', { class: 'login-page' }, h('div', { class: 'card login-card' }, brandBlock(false), h('h1', 'Welcome back'), h('p', { class: 'muted', style: 'margin:0' }, 'Sign in with your admin account.'), form)),
  );
  setTimeout(() => email.focus(), 30);
}

/* ------------------------------------------------------------------ shell */

function renderShell() {
  const navEl = h(
    'nav',
    { class: 'nav', 'aria-label': 'Main' },
    NAV.map((section) => [
      section.label && h('div', { class: 'nav-label' }, section.label),
      section.items.map((it) =>
        h('a', { href: `#/${it.path}`, dataset: { path: it.path } }, icon(it.icon), h('span', it.label), it.countKey && h('span', { class: 'count', dataset: { count: it.countKey }, hidden: true })),
      ),
    ]),
  );

  const logout = h('button', { class: 'btn-icon', title: 'Sign out', 'aria-label': 'Sign out' }, icon('logout'));
  logout.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    app.user = null;
    location.hash = '';
    renderLogin();
  });

  const meBlock = h('div', { class: 'me' },
    h('a', { href: '#/account', class: 'avatar', title: 'My account', style: 'text-decoration:none' }, fmt.initials(app.user.name)),
    h('a', { href: '#/account', style: 'min-width:0;text-decoration:none' }, h('div', { class: 'me-name truncate' }, app.user.name), h('div', { class: 'me-email truncate' }, app.user.email)),
    logout,
  );

  const sidebar = h('aside', { class: 'sidebar' }, brandBlock(), navEl, h('div', { class: 'sidebar-foot' }, meBlock));
  const content = h('main', { class: 'content', id: 'content', tabindex: '-1' });
  const menuBtn = h('button', { class: 'btn-icon', style: 'color:#fff', 'aria-label': 'Open menu' }, icon('menu'));
  const topTitle = h('strong', { class: 'truncate' }, app.brand.site_name || 'Control Panel');
  const appEl = h('div', { class: 'app' }, sidebar, h('div', { class: 'main' }, h('div', { class: 'topbar' }, menuBtn, topTitle), content));
  menuBtn.addEventListener('click', () => appEl.classList.toggle('nav-open'));
  appEl.addEventListener('click', (e) => {
    if (appEl.classList.contains('nav-open') && (e.target.closest('.nav a') || e.target === appEl)) appEl.classList.remove('nav-open');
  });

  root.replaceChildren(appEl);
  shell = { appEl, navEl, content, sidebar, meBlock };
  refreshCounts();
  clearInterval(countTimer);
  countTimer = setInterval(refreshCounts, 60000);
}

async function refreshCounts() {
  if (!shell) return;
  try {
    const s = await api('/api/admin/enquiries/stats');
    const el = shell.navEl.querySelector('[data-count="enquiries"]');
    el.textContent = s.new > 99 ? '99+' : s.new;
    el.hidden = !s.new;
    el.title = `${s.new} new enquir${s.new === 1 ? 'y' : 'ies'}`;
  } catch {
    /* ignore */
  }
}
window.addEventListener('enquiries:changed', refreshCounts);

/* ------------------------------------------------------------------ router */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { path: path || 'dashboard', query: Object.fromEntries(new URLSearchParams(query)) };
}

function route() {
  if (!shell) return;
  let { path, query } = parseHash();
  if (!ROUTES[path]) path = 'dashboard';
  const r = ROUTES[path];

  // One-shot params (open "new" form / a specific record) shouldn't re-trigger on reload.
  if (query.new || query.id) {
    const keep = Object.fromEntries(Object.entries(query).filter(([k]) => k !== 'new' && k !== 'id'));
    const q = new URLSearchParams(keep).toString();
    history.replaceState(null, '', `#/${path}${q ? `?${q}` : ''}`);
  }

  for (const a of shell.navEl.querySelectorAll('a')) a.classList.toggle('active', a.dataset.path === path);
  document.title = `${r.label} · ${app.brand.site_name || 'Control Panel'}`;
  const content = h('main', { class: 'content', id: 'content', tabindex: '-1' });
  shell.content.replaceWith(content);
  shell.content = content;
  window.scrollTo(0, 0);

  const ctx = {
    user: app.user,
    meta: app.meta,
    query,
    setUser(u) {
      app.user = { ...app.user, ...u };
      renderShell();
      route();
    },
    async refreshBrand() {
      await loadBrand();
      renderShell();
      route();
    },
  };
  try {
    r.page(content, ctx);
  } catch (e) {
    console.error(e);
    toast('Something went wrong loading this page.', 'error');
  }
  refreshCounts();
}

window.addEventListener('hashchange', route);
boot();
