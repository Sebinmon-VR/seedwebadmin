import { h, icon, toast, drawer, confirmDialog, spinner, emptyState, pager, setLoading, debounce } from './ui.js';
import { api, upload, qs } from './api.js';
import { buildForm, invalidateOptions } from './forms.js';

/** Head of a page: title, description and action buttons. */
export const pageHead = (title, text, ...actions) =>
  h('div', { class: 'page-head' }, h('div', h('h1', title), text && h('p', text)), h('div', { class: 'page-actions' }, actions));

/**
 * Open a create/edit drawer for a record and save it with a multipart upload (with progress).
 * Resolves to the saved record, or null if the drawer was closed.
 */
export function openEditor({ endpoint, singular, fields, record, defaults = {}, wide, onDelete, deleteLabel }) {
  return new Promise((resolve) => {
    const isNew = !record?.id;
    const form = buildForm(typeof fields === 'function' ? fields(record || {}) : fields, isNew ? { ...defaults, ...(record || {}) } : record);
    let result = null;
    let busy = false;
    const d = drawer({ title: isNew ? `New ${singular}` : `Edit ${singular}`, wide, onClose: () => resolve(result) });
    d.layer.canClose = () => !busy;

    const formEl = h('form', { novalidate: true }, form.el, h('button', { type: 'submit', hidden: true }));
    d.body.append(formEl);

    const status = h('div', { class: 'left' });
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, icon('check'), isNew ? `Create ${singular}` : 'Save changes');
    const cancel = h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancel');
    if (!isNew && onDelete) {
      status.append(
        h('button', {
          type: 'button',
          class: 'btn btn-ghost',
          style: 'color:var(--danger)',
          onclick: async () => {
            if (await onDelete(record)) {
              result = { deleted: true };
              d.close();
            }
          },
        }, icon('trash'), deleteLabel || 'Delete'),
      );
    }
    d.foot.append(status, cancel, save);

    const submit = async () => {
      if (busy || !form.validate()) return;
      busy = true;
      setLoading(save, true);
      const bar = h('div', { class: 'progress', style: 'flex:1;max-width:220px' }, h('div'));
      const pct = h('span', { class: 'muted', style: 'font-size:12.5px' });
      const showProgress = form.hasFiles();
      const prev = [...status.childNodes];
      if (showProgress) status.replaceChildren(bar, pct);
      try {
        const fd = form.toFormData();
        result = await upload(isNew ? endpoint : `${endpoint}/${record.id}`, fd, {
          method: isNew ? 'POST' : 'PUT',
          onProgress: showProgress
            ? (p) => {
                bar.firstChild.style.width = `${Math.round(p * 100)}%`;
                pct.textContent = p < 1 ? `Uploading ${Math.round(p * 100)}%` : 'Processing…';
              }
            : null,
        });
        invalidateOptions();
        toast(isNew ? `${cap(singular)} created` : 'Changes saved');
        busy = false;
        d.close();
      } catch (e) {
        busy = false;
        setLoading(save, false);
        status.replaceChildren(...prev);
        form.setErrors(e.fields, e.message);
        toast(e.message, 'error');
      }
    };
    save.addEventListener('click', submit);
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    form.focusFirst();
  });
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Generic list page with search, filters, pagination, bulk delete and a drawer editor.
 * cfg: { title, description, endpoint, singular, plural, emptyIcon, columns, filters, fields, defaults, wide,
 *        rowActions(row, reload), searchPlaceholder, titleOf(row) }
 */
export function resourcePage(cfg) {
  return (root, ctx) => {
    const state = { page: 1, q: '', ...Object.fromEntries((cfg.filters || []).map((f) => [f.name, ctx.query[f.name] || ''])) };
    const selected = new Set();
    let lastItems = [];

    const remove = async (row) => {
      const ok = await confirmDialog({
        title: `Delete this ${cfg.singular}?`,
        message: `"${cfg.titleOf ? cfg.titleOf(row) : row.title}" will be removed from the website permanently, including its uploaded files.`,
      });
      if (!ok) return false;
      try {
        await api(`${cfg.endpoint}/${row.id}`, { method: 'DELETE' });
        toast(`${cap(cfg.singular)} deleted`);
        return true;
      } catch (e) {
        toast(e.message, 'error');
        return false;
      }
    };

    const edit = async (row) => {
      let record = row;
      if (row?.id) {
        try {
          record = await api(`${cfg.endpoint}/${row.id}`);
        } catch (e) {
          return toast(e.message, 'error');
        }
      }
      const res = await openEditor({ ...cfg, record, onDelete: remove });
      if (res) load();
    };

    const addBtn = h('button', { class: 'btn btn-primary', onclick: () => edit(null) }, icon('plus'), `New ${cfg.singular}`);
    const search = h('input', { class: 'input', type: 'search', placeholder: cfg.searchPlaceholder || 'Search…', value: state.q });
    search.addEventListener('input', debounce(() => ((state.q = search.value.trim()), (state.page = 1), load()), 300));

    const filterEls = (cfg.filters || []).map((f) => {
      const s = h('select', { class: 'select', 'aria-label': f.placeholder }, h('option', { value: '' }, f.placeholder), f.options.map((o) => h('option', { value: o.value }, o.label)));
      s.value = state[f.name];
      s.addEventListener('change', () => ((state[f.name] = s.value), (state.page = 1), load()));
      return s;
    });

    const bulk = h('div', { class: 'bulkbar', hidden: true });
    const tableHost = h('div');
    const pagerHost = h('div');
    root.append(
      pageHead(cfg.title, cfg.description, addBtn),
      h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), filterEls), bulk, tableHost, pagerHost),
    );

    const renderBulk = () => {
      bulk.hidden = !selected.size;
      bulk.replaceChildren(
        h('span', `${selected.size} selected`),
        h('button', {
          class: 'btn btn-sm btn-danger',
          onclick: async () => {
            if (!(await confirmDialog({ title: `Delete ${selected.size} ${selected.size === 1 ? cfg.singular : cfg.plural}?`, message: 'This cannot be undone.' }))) return;
            try {
              const r = await api(`${cfg.endpoint}/bulk-delete`, { method: 'POST', body: { ids: [...selected] } });
              toast(`${r.deleted} deleted`);
              selected.clear();
              load();
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        }, icon('trash'), 'Delete'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => (selected.clear(), renderTable(lastItems), renderBulk()) }, 'Clear selection'),
      );
    };

    const renderTable = (items) => {
      if (!items.length) {
        const filtered = state.q || (cfg.filters || []).some((f) => state[f.name]);
        tableHost.replaceChildren(
          emptyState({
            iconName: cfg.emptyIcon,
            title: filtered ? 'Nothing matches your filters' : `No ${cfg.plural} yet`,
            text: filtered ? 'Try a different search or clear the filters.' : cfg.emptyText,
            action: !filtered && h('button', { class: 'btn btn-primary', onclick: () => edit(null) }, icon('plus'), `Add your first ${cfg.singular}`),
          }),
        );
        return;
      }
      const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all', checked: items.every((r) => selected.has(r.id)) });
      allBox.addEventListener('change', () => {
        for (const r of items) allBox.checked ? selected.add(r.id) : selected.delete(r.id);
        renderTable(items);
        renderBulk();
      });
      tableHost.replaceChildren(
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'table' },
            h('thead', h('tr', h('th', { class: 'col-check' }, allBox), cfg.columns.map((c) => h('th', { class: c.class || '' }, c.label)), h('th', { class: 'col-actions' }))),
            h(
              'tbody',
              items.map((row) => {
                const box = h('input', { type: 'checkbox', 'aria-label': 'Select', checked: selected.has(row.id) });
                box.addEventListener('click', (e) => e.stopPropagation());
                box.addEventListener('change', () => {
                  box.checked ? selected.add(row.id) : selected.delete(row.id);
                  allBox.checked = items.every((r) => selected.has(r.id));
                  renderBulk();
                });
                return h(
                  'tr',
                  { class: 'clickable', onclick: () => edit(row) },
                  h('td', { class: 'col-check' }, box),
                  cfg.columns.map((c) => h('td', { class: c.class || '' }, c.render(row))),
                  h(
                    'td',
                    { class: 'col-actions', onclick: (e) => e.stopPropagation() },
                    cfg.rowActions?.(row, load),
                    h('button', { class: 'btn-icon', title: 'Edit', 'aria-label': 'Edit', onclick: () => edit(row) }, icon('edit')),
                    h('button', { class: 'btn-icon danger', title: 'Delete', 'aria-label': 'Delete', onclick: async () => (await remove(row)) && load() }, icon('trash')),
                  ),
                );
              }),
            ),
          ),
        ),
      );
    };

    let seq = 0;
    async function load() {
      const my = ++seq;
      if (!lastItems.length) tableHost.replaceChildren(spinner());
      try {
        const params = { page: state.page, limit: 20, q: state.q };
        for (const f of cfg.filters || []) params[f.name] = state[f.name];
        const data = await api(`${cfg.endpoint}${qs(params)}`);
        if (my !== seq) return;
        if (!data.items.length && state.page > 1) {
          state.page--;
          return load();
        }
        lastItems = data.items;
        renderTable(data.items);
        pagerHost.replaceChildren(pager({ ...data, onPage: (p) => ((state.page = p), load()) }));
        renderBulk();
      } catch (e) {
        tableHost.replaceChildren(emptyState({ iconName: 'alert', title: 'Could not load', text: e.message }));
      }
    }

    load();
    if (ctx.query.new) edit(null);
  };
}

/** Image/icon + title + subtitle cell. */
export function mainCell({ thumb, iconName = 'image', title, sub, extra }) {
  return h(
    'div',
    { class: 'cell-main' },
    h('div', { class: 'cell-thumb', style: thumb ? `background-image:url("${encodeURI(thumb)}")` : '' }, !thumb && icon(iconName)),
    h('div', { style: 'min-width:0' }, h('div', { class: 'cell-title' }, title, extra), sub && h('div', { class: 'cell-sub truncate', style: 'max-width:420px' }, sub)),
  );
}
