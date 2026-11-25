import { h, icon, fmt, toast, confirmDialog, spinner, emptyState, setLoading, copyText } from '../ui.js';
import { api, upload } from '../api.js';
import { buildForm } from '../forms.js';
import { pageHead, openEditor } from '../resource.js';

/* ------------------------------------------------------------------ website settings */

const SETTINGS_FIELDS = [
  { type: 'section', label: 'Identity' },
  { name: 'site_name', label: 'Website / institution name', placeholder: 'e.g. SEED International School' },
  { name: 'tagline', label: 'Tagline', placeholder: 'e.g. Nurturing young minds' },
  { name: 'site_logo', label: 'Logo', type: 'image' },
  { name: 'website_url', label: 'Website address', type: 'url', placeholder: 'https://www.yourschool.com', help: 'Where your website lives. Website images reads the list of pictures from here.' },
  { type: 'section', label: 'Contact details' },
  { name: 'contact_phone', label: 'Phone' },
  { name: 'contact_email', label: 'Email', type: 'email' },
  { name: 'whatsapp', label: 'WhatsApp number', placeholder: '+91 98765 43210' },
  { name: 'office_hours', label: 'Office hours', placeholder: 'Mon–Sat, 9:00 AM – 4:00 PM' },
  { name: 'address', label: 'Address', type: 'textarea', rows: 3, span: 2 },
  { name: 'map_url', label: 'Google Maps link', type: 'url', span: 2 },
  { type: 'section', label: 'Social media' },
  { name: 'facebook_url', label: 'Facebook', type: 'url', placeholder: 'https://facebook.com/…' },
  { name: 'instagram_url', label: 'Instagram', type: 'url', placeholder: 'https://instagram.com/…' },
  { name: 'youtube_url', label: 'YouTube', type: 'url', placeholder: 'https://youtube.com/@…' },
  { name: 'x_url', label: 'X / Twitter', type: 'url' },
  { name: 'linkedin_url', label: 'LinkedIn', type: 'url' },
  { type: 'section', label: 'Admissions' },
  { name: 'admissions_open', type: 'toggle', toggleLabel: 'Admissions are open', span: 2, help: 'Your website can use this to show or hide the admission form. Enquiries are always accepted and saved.' },
  { name: 'admission_message', label: 'Admission message', type: 'textarea', rows: 3, span: 2, placeholder: 'e.g. Admissions open for 2027–28. Classes Nursery to Grade 10.' },
];

export async function settings(root, ctx) {
  const save = h('button', { class: 'btn btn-primary' }, icon('check'), 'Save settings');
  root.append(pageHead('Website settings', 'Contact details, social links and admission status used across your website.', save));
  const card = h('div', { class: 'card' }, h('div', { class: 'card-body' }, spinner()));
  root.append(card);

  let current;
  try {
    current = await api('/api/admin/settings');
  } catch (e) {
    card.replaceChildren(emptyState({ iconName: 'alert', title: 'Could not load settings', text: e.message }));
    return;
  }
  let form = buildForm(SETTINGS_FIELDS, current);
  card.firstChild.replaceChildren(form.el);

  save.addEventListener('click', async () => {
    setLoading(save, true);
    try {
      current = await upload('/api/admin/settings', form.toFormData(), { method: 'PUT' });
      toast('Settings saved');
      form = buildForm(SETTINGS_FIELDS, current);
      card.firstChild.replaceChildren(form.el);
      ctx.refreshBrand?.();
    } catch (e) {
      form.setErrors(e.fields, e.message);
      toast(e.message, 'error');
    }
    setLoading(save, false);
  });
}

/* ------------------------------------------------------------------ my account */

export function account(root, ctx) {
  root.append(pageHead('My account', 'Update your name, email and password.'));

  const profile = buildForm(
    [
      { name: 'name', label: 'Name', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
    ],
    ctx.user,
  );
  const saveProfile = h('button', { class: 'btn btn-primary' }, 'Save profile');
  saveProfile.addEventListener('click', async () => {
    if (!profile.validate()) return;
    setLoading(saveProfile, true);
    try {
      const { user } = await api('/api/admin/users/me', { method: 'PATCH', body: profile.values() });
      ctx.setUser(user);
      toast('Profile updated');
    } catch (e) {
      profile.setErrors(e.fields, e.message);
      toast(e.message, 'error');
    }
    setLoading(saveProfile, false);
  });

  const pw = buildForm([
    { name: 'current_password', label: 'Current password', required: true },
    { name: 'new_password', label: 'New password', required: true, help: 'At least 8 characters.' },
    { name: 'confirm', label: 'Confirm new password', required: true },
  ]);
  for (const n of ['current_password', 'new_password', 'confirm']) {
    const input = pw.control(n).el;
    input.type = 'password';
    input.autocomplete = n === 'current_password' ? 'current-password' : 'new-password';
  }
  const savePw = h('button', { class: 'btn btn-primary' }, icon('lock'), 'Change password');
  savePw.addEventListener('click', async () => {
    if (!pw.validate()) return;
    const v = pw.values();
    if (v.new_password !== v.confirm) return pw.setErrors({ confirm: 'Passwords do not match.' });
    setLoading(savePw, true);
    try {
      await api('/api/admin/users/me/password', { method: 'POST', body: { current_password: v.current_password, new_password: v.new_password } });
      toast('Password changed. Other devices were signed out.');
      for (const n of ['current_password', 'new_password', 'confirm']) pw.control(n).el.value = '';
    } catch (e) {
      pw.setErrors(e.fields, e.message);
      toast(e.message, 'error');
    }
    setLoading(savePw, false);
  });

  root.append(
    h('div', { style: 'display:grid;gap:14px;max-width:720px' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', 'Profile')), h('div', { class: 'card-body' }, profile.el, h('div', { style: 'margin-top:16px' }, saveProfile))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', 'Password')), h('div', { class: 'card-body' }, pw.el, h('div', { style: 'margin-top:16px' }, savePw))),
    ),
  );
}

/* ------------------------------------------------------------------ admins */

export function admins(root, ctx) {
  const addBtn = h('button', { class: 'btn btn-primary' }, icon('plus'), 'Add admin');
  const host = h('div', spinner());
  root.append(pageHead('Admins', 'People who can sign in to this control panel.', addBtn), h('div', { class: 'card' }, host));

  addBtn.addEventListener('click', async () => {
    const res = await openEditor({
      endpoint: '/api/admin/users',
      singular: 'admin',
      fields: [
        { name: 'name', label: 'Name', required: true, span: 2 },
        { name: 'email', label: 'Email', type: 'email', required: true, span: 2 },
        { name: 'password', label: 'Temporary password', required: true, span: 2, help: 'At least 8 characters. Ask them to change it after signing in.' },
      ],
    });
    if (res) load();
  });

  async function load() {
    try {
      const { items } = await api('/api/admin/users');
      host.replaceChildren(
        h('div', { class: 'table-wrap' },
          h('table', { class: 'table' },
            h('thead', h('tr', h('th', 'Name'), h('th', 'Email'), h('th', { class: 'hide-sm' }, 'Last sign-in'), h('th', { class: 'hide-sm' }, 'Added'), h('th', { class: 'col-actions' }))),
            h('tbody', items.map((u) =>
              h('tr',
                h('td', h('div', { class: 'cell-main', style: 'min-width:0' }, h('div', { class: 'avatar', style: 'background:var(--accent-soft);color:var(--accent-hover)' }, fmt.initials(u.name)), h('div', { class: 'cell-title' }, u.name, u.id === ctx.user.id ? h('span', { class: 'muted', style: 'font-weight:400' }, ' (you)') : null))),
                h('td', u.email),
                h('td', { class: 'hide-sm muted' }, u.last_login_at ? fmt.relative(u.last_login_at) : 'Never'),
                h('td', { class: 'hide-sm muted' }, fmt.date(u.created_at)),
                h('td', { class: 'col-actions' }, u.id !== ctx.user.id && h('button', {
                  class: 'btn-icon danger', title: 'Remove admin', 'aria-label': 'Remove admin',
                  onclick: async () => {
                    if (!(await confirmDialog({ title: `Remove ${u.name}?`, message: `${u.email} will no longer be able to sign in.`, confirmText: 'Remove' }))) return;
                    try {
                      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                      toast('Admin removed');
                      load();
                    } catch (e) {
                      toast(e.message, 'error');
                    }
                  },
                }, icon('trash'))),
              ),
            )),
          ),
        ),
      );
    } catch (e) {
      host.replaceChildren(emptyState({ iconName: 'alert', title: 'Could not load admins', text: e.message }));
    }
  }
  load();
}

/* ------------------------------------------------------------------ website integration */

export function integration(root, ctx) {
  const base = `${ctx.meta.publicBaseUrl}/api/public`;
  root.append(pageHead('Website integration', 'How your website reads content from this control panel and sends admission enquiries.'));

  const ep = (method, path, desc) =>
    h('div', { class: 'endpoint' },
      h('span', { class: `method ${method === 'POST' ? 'post' : ''}` }, method),
      h('code', path),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn-icon', title: 'Copy URL', 'aria-label': 'Copy URL', onclick: () => copyText(`${base}${path.split('?')[0]}`) }, icon('copy')),
      method === 'GET' && !path.includes(':') && h('a', { class: 'btn-icon', title: 'Open', 'aria-label': 'Open', href: `${base}${path.split('?')[0]}`, target: '_blank', rel: 'noopener' }, icon('external')),
      h('div', { class: 'd' }, desc),
    );

  const origins = ctx.meta.allowedOrigins;
  const formSnippet = `<form id="admission-form">
  <input name="student_name" placeholder="Student name" required>
  <input name="parent_name" placeholder="Parent / guardian name">
  <input name="phone" placeholder="Phone" required>
  <input name="email" type="email" placeholder="Email">
  <input name="class_applying" placeholder="Class applying for">
  <textarea name="message" placeholder="Message"></textarea>
  <!-- spam trap: keep hidden -->
  <input name="website" tabindex="-1" autocomplete="off" style="display:none">
  <button type="submit">Send enquiry</button>
  <p id="admission-result"></p>
</form>
<script>
document.getElementById('admission-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = document.getElementById('admission-result');
  const res = await fetch('${base}/enquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
  });
  const data = await res.json();
  out.textContent = res.ok ? data.message : data.error;
  if (res.ok) e.target.reset();
});
</script>`;

  const fetchSnippet = `// Latest notices, ticker, live/upcoming events, posts and featured media in one call
const home = await fetch('${base}/home').then((r) => r.json());

// Paginated lists
const notices = await fetch('${base}/notices?page=1&limit=10').then((r) => r.json());
const events  = await fetch('${base}/events?when=upcoming').then((r) => r.json());
const photos  = await fetch('${base}/gallery?album=Sports%20Day').then((r) => r.json());`;

  const code = (text) => h('div', { style: 'position:relative' }, h('pre', { class: 'code' }, text), h('button', { class: 'btn btn-sm', style: 'position:absolute;top:8px;right:8px', onclick: () => copyText(text) }, icon('copy'), 'Copy'));

  root.append(
    h('div', { style: 'display:grid;gap:14px' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', 'Connection')),
        h('div', { class: 'card-body' },
          h('dl', { class: 'dl' },
            h('dt', 'API base URL'), h('dd', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap' }, h('code', { class: 'mono' }, base), ' ', h('button', { class: 'btn-icon', 'aria-label': 'Copy', onclick: () => copyText(base) }, icon('copy'))),
            h('dt', 'Allowed websites'), h('dd', origins.length ? origins.join(', ') : h('span', { style: 'color:var(--danger)' }, 'None yet — set ALLOWED_ORIGINS in the .env file so your website can call the API from the browser.')),
          ),
        ),
      ),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', 'Content endpoints (read-only)')),
        h('div', { class: 'card-body', style: 'padding-top:4px' },
          ep('GET', '/home', 'Everything a homepage needs: settings, ticker, notices, live & upcoming events, latest posts, featured photos & videos.'),
          ep('GET', '/settings', 'Website name, logo, contact details, social links, admissions open/closed.'),
          ep('GET', '/notices?category=&ticker=1', 'Currently visible notices (pinned & urgent first). ticker=1 for the scrolling ticker.'),
          ep('GET', '/events?when=upcoming|live|past', 'Events with state (upcoming / live / past / cancelled) and live stream embed links.'),
          ep('GET', '/posts?category=&q=', 'Published posts, newest first.'),
          ep('GET', '/posts/:slug', 'A single post with full HTML content.'),
          ep('GET', '/gallery?album=&featured=1', 'Published photos.'),
          ep('GET', '/gallery/albums', 'Albums with photo counts and cover image.'),
          ep('GET', '/videos?category=&featured=1', 'Videos with playable file URL or embed URL.'),
          ep('GET', '/site-images', 'Pictures replaced under Website images, as { key: url }. Also included in /home as site_images.'),
          ep('POST', '/enquiries', 'Submit an admission enquiry (student_name and phone are required). Limited to 5 per 10 minutes per visitor.'),
        ),
      ),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', 'Reading content')), h('div', { class: 'card-body' }, code(fetchSnippet))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', 'Admission enquiry form')),
        h('div', { class: 'card-body' },
          h('p', { class: 'muted', style: 'margin:0 0 12px' }, 'Paste this into your website’s admissions page. Accepted fields: student_name, parent_name, phone, email, class_applying, date_of_birth (YYYY-MM-DD), previous_school, message, source.'),
          code(formSnippet),
        ),
      ),
    ),
  );
}
