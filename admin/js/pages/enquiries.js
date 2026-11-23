import { h, icon, badge, fmt, toast, drawer, confirmDialog, spinner, emptyState, pager, setLoading, debounce } from '../ui.js';
import { api, qs } from '../api.js';
import { pageHead, openEditor } from '../resource.js';

export const STATUSES = [
  { value: 'new', label: 'New', tone: 'green' },
  { value: 'contacted', label: 'Contacted', tone: 'blue' },
  { value: 'visited', label: 'Visited', tone: 'purple' },
  { value: 'enrolled', label: 'Enrolled', tone: 'amber' },
  { value: 'closed', label: 'Closed', tone: '' },
];
export const statusBadge = (s) => {
  const st = STATUSES.find((x) => x.value === s);
  return badge(st ? st.label : s, st?.tone);
};

const ADD_FIELDS = [
  { name: 'student_name', label: 'Student name', required: true },
  { name: 'class_applying', label: 'Class / course', datalist: 'enquiries/class_applying' },
  { name: 'parent_name', label: 'Parent / guardian' },
  { name: 'phone', label: 'Phone', required: true, placeholder: '+91 98765 43210' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { name: 'previous_school', label: 'Previous school', span: 2 },
  { name: 'message', label: 'Message / notes from enquiry', type: 'textarea', rows: 3, span: 2 },
  { name: 'source', label: 'How did they enquire?', type: 'select', options: ['office', 'phone', 'walk-in', 'email', 'whatsapp', 'social media', 'referral', 'website'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
];

/** Strip everything but digits for tel:/WhatsApp links. */
const digits = (p) => String(p || '').replace(/[^\d+]/g, '');

export function enquiries(root, ctx) {
  const state = { page: 1, q: '', status: ctx.query.status || '', from: '', to: '' };
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const listHost = h('div');
  const pagerHost = h('div');

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search name, phone, email, class…' });
  search.addEventListener('input', debounce(() => ((state.q = search.value.trim()), (state.page = 1), load()), 300));
  const from = h('input', { class: 'input', type: 'date', style: 'width:auto', 'aria-label': 'From date' });
  const to = h('input', { class: 'input', type: 'date', style: 'width:auto', 'aria-label': 'To date' });
  for (const [el, key] of [[from, 'from'], [to, 'to']]) el.addEventListener('change', () => ((state[key] = el.value), (state.page = 1), load()));

  const exportBtn = h('a', { class: 'btn', href: '#', download: '' }, icon('download'), 'Export CSV');
  const updateExport = () => (exportBtn.href = `/api/admin/enquiries/export.csv${qs({ status: state.status, q: state.q, from: state.from, to: state.to })}`);
  const addBtn = h('button', { class: 'btn btn-primary', onclick: addEnquiry }, icon('plus'), 'Add enquiry');

  root.append(
    pageHead('Admission enquiries', 'Enquiries sent from the website’s admission form, plus ones you add from calls and walk-ins.', exportBtn, addBtn),
    h('div', { class: 'card' }, tabs, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), h('span', { class: 'muted' }, 'From'), from, h('span', { class: 'muted' }, 'to'), to), listHost, pagerHost),
  );

  async function loadTabs() {
    try {
      const s = await api('/api/admin/enquiries/stats');
      const tab = (value, label, n) =>
        h('button', { role: 'tab', class: state.status === value ? 'active' : '', 'aria-selected': String(state.status === value), onclick: () => ((state.status = value), (state.page = 1), loadTabs(), load()) }, label, h('span', { class: 'n' }, n));
      tabs.replaceChildren(tab('', 'All', s.total), ...STATUSES.map((st) => tab(st.value, st.label, s[st.value])));
    } catch {
      /* tabs are optional */
    }
  }

  async function addEnquiry() {
    const res = await openEditor({ endpoint: '/api/admin/enquiries', singular: 'enquiry', fields: ADD_FIELDS, defaults: { source: 'office' } });
    if (res) refresh();
  }

  const statusSelect = (row, onChange) => {
    const s = h('select', { class: 'select', style: 'height:30px;font-size:13px;width:auto;min-width:120px', 'aria-label': 'Status' }, STATUSES.map((st) => h('option', { value: st.value }, st.label)));
    s.value = row.status;
    s.addEventListener('click', (e) => e.stopPropagation());
    s.addEventListener('change', async () => {
      try {
        const updated = await api(`/api/admin/enquiries/${row.id}`, { method: 'PATCH', body: { status: s.value } });
        Object.assign(row, updated);
        toast(`Marked as ${STATUSES.find((x) => x.value === s.value).label.toLowerCase()}`);
        onChange?.(updated);
        loadTabs();
        window.dispatchEvent(new Event('enquiries:changed'));
      } catch (e) {
        s.value = row.status;
        toast(e.message, 'error');
      }
    });
    return s;
  };

  function render(items) {
    if (!items.length) {
      const filtered = state.q || state.status || state.from || state.to;
      listHost.replaceChildren(
        emptyState({
          iconName: 'inbox',
          title: filtered ? 'No enquiries match' : 'No enquiries yet',
          text: filtered ? 'Try clearing the filters.' : 'When visitors submit the admission form on your website, they will appear here.',
        }),
      );
      return;
    }
    listHost.replaceChildren(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', h('tr', h('th', 'Student'), h('th', { class: 'hide-sm' }, 'Parent / guardian'), h('th', 'Contact'), h('th', { class: 'hide-sm' }, 'Received'), h('th', 'Status'))),
          h(
            'tbody',
            items.map((r) =>
              h(
                'tr',
                { class: 'clickable', onclick: () => openDetail(r.id) },
                h('td', h('div', { class: 'cell-title' }, r.status === 'new' ? h('span', { style: 'display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:8px' }) : null, r.student_name), h('div', { class: 'cell-sub' }, r.class_applying || '—')),
                h('td', { class: 'hide-sm' }, r.parent_name || h('span', { class: 'faint' }, '—')),
                h('td', h('div', { class: 'nowrap' }, r.phone), r.email && h('div', { class: 'cell-sub' }, r.email)),
                h('td', { class: 'hide-sm nowrap', title: fmt.dateTime(r.created_at) }, fmt.relative(r.created_at), h('div', { class: 'cell-sub' }, r.source || '')),
                h('td', statusSelect(r)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  let seq = 0;
  async function load() {
    const my = ++seq;
    updateExport();
    listHost.childElementCount || listHost.replaceChildren(spinner());
    try {
      const data = await api(`/api/admin/enquiries${qs({ ...state, limit: 25 })}`);
      if (my !== seq) return;
      render(data.items);
      pagerHost.replaceChildren(pager({ ...data, onPage: (p) => ((state.page = p), load()) }));
    } catch (e) {
      listHost.replaceChildren(emptyState({ iconName: 'alert', title: 'Could not load enquiries', text: e.message }));
    }
  }

  const refresh = () => {
    loadTabs();
    load();
    window.dispatchEvent(new Event('enquiries:changed'));
  };

  async function openDetail(id) {
    let r;
    try {
      r = await api(`/api/admin/enquiries/${id}`);
    } catch (e) {
      return toast(e.message, 'error');
    }
    const d = drawer({ title: r.student_name, onClose: () => load() });
    const phone = digits(r.phone);
    const wa = phone.replace(/^\+/, '');
    const notes = h('textarea', { class: 'textarea', rows: 5, placeholder: 'Follow-up notes, call outcomes, visit date…', value: r.notes || '' });
    const badgeHolder = h('span', statusBadge(r.status));
    const statusHolder = h('div');
    statusHolder.append(statusSelect(r, (u) => badgeHolder.replaceChildren(statusBadge(u.status))));

    const row = (label, value) => value ? [h('dt', label), h('dd', value)] : null;
    d.body.append(
      h('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap' }, badgeHolder, h('span', { class: 'muted' }, `Received ${fmt.dateTime(r.created_at)}`), r.source && badge(`via ${r.source}`)),
      h(
        'div',
        { class: 'contact-actions' },
        h('a', { class: 'btn btn-sm', href: `tel:${phone}` }, icon('phone'), 'Call'),
        wa.length >= 10 && h('a', { class: 'btn btn-sm', href: `https://wa.me/${wa}`, target: '_blank', rel: 'noopener' }, icon('chat'), 'WhatsApp'),
        r.email && h('a', { class: 'btn btn-sm', href: `mailto:${r.email}?subject=${encodeURIComponent('Regarding your admission enquiry')}` }, icon('mail'), 'Email'),
      ),
      h(
        'dl',
        { class: 'dl' },
        row('Student', r.student_name),
        row('Class / course', r.class_applying),
        row('Date of birth', r.date_of_birth && fmt.date(`${r.date_of_birth}T00:00:00`)),
        row('Parent / guardian', r.parent_name),
        row('Phone', r.phone),
        row('Email', r.email),
        row('Previous school', r.previous_school),
      ),
      r.message && h('div', { style: 'margin-top:18px' }, h('div', { class: 'field-label', style: 'margin-bottom:6px' }, 'Message'), h('div', { class: 'callout' }, r.message)),
      h('div', { class: 'form-section', style: 'margin:22px 0 14px' }, 'Follow-up'),
      h('div', { class: 'field', style: 'margin-bottom:14px' }, h('label', 'Status'), statusHolder),
      h('div', { class: 'field' }, h('label', 'Internal notes'), notes, h('div', { class: 'help' }, 'Only visible to admins.')),
    );

    const save = h('button', { class: 'btn btn-primary' }, icon('check'), 'Save notes');
    save.addEventListener('click', async () => {
      setLoading(save, true);
      try {
        await api(`/api/admin/enquiries/${r.id}`, { method: 'PATCH', body: { notes: notes.value } });
        toast('Notes saved');
      } catch (e) {
        toast(e.message, 'error');
      }
      setLoading(save, false);
    });
    const delBtn = h('button', { class: 'btn btn-ghost', style: 'color:var(--danger)' }, icon('trash'), 'Delete');
    delBtn.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Delete this enquiry?', message: `The enquiry from ${r.student_name} will be permanently deleted.` }))) return;
      try {
        await api(`/api/admin/enquiries/${r.id}`, { method: 'DELETE' });
        toast('Enquiry deleted');
        d.close();
        refresh();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
    d.foot.append(h('div', { class: 'left' }, delBtn), h('button', { class: 'btn', onclick: () => d.close() }, 'Close'), save);
  }

  loadTabs();
  load();
  if (ctx.query.id) openDetail(ctx.query.id);
  if (ctx.query.new) addEnquiry();
}
