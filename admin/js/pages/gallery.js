import { h, icon, badge, toast, drawer, confirmDialog, spinner, emptyState, pager, setLoading, debounce, lightbox, fmt } from '../ui.js';
import { api, upload, qs } from '../api.js';
import { buildForm, ACCEPT, limits, invalidateOptions } from '../forms.js';
import { pageHead, openEditor } from '../resource.js';

const EDIT_FIELDS = [
  { name: 'file', label: 'Image', type: 'image', required: true },
  { name: 'title', label: 'Title', span: 2 },
  { name: 'caption', label: 'Caption', type: 'textarea', rows: 2, span: 2 },
  { name: 'album', label: 'Album', datalist: 'gallery/album', placeholder: 'e.g. Sports Day 2026' },
  { name: 'status', label: 'Status', type: 'select', options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Hidden' }] },
  { name: 'is_featured', type: 'toggle', toggleLabel: 'Feature on the homepage' },
];

export function gallery(root, ctx) {
  const state = { page: 1, q: '', album: ctx.query.album ?? '', status: '' };
  const selected = new Set();
  let items = [];

  const uploadBtn = h('button', { class: 'btn btn-primary', onclick: () => openUploader() }, icon('upload'), 'Upload photos');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search photos…' });
  search.addEventListener('input', debounce(() => ((state.q = search.value.trim()), (state.page = 1), load()), 300));
  const statusSel = h('select', { class: 'select', 'aria-label': 'Status' }, h('option', { value: '' }, 'All photos'), h('option', { value: 'published' }, 'Published'), h('option', { value: 'draft' }, 'Hidden'), h('option', { value: '1', dataset: { featured: '1' } }, 'Featured only'));
  statusSel.addEventListener('change', () => ((state.page = 1), load()));

  const chips = h('div', { class: 'album-chips' });
  const bulk = h('div', { class: 'bulkbar', hidden: true });
  const gridHost = h('div');
  const pagerHost = h('div');

  root.append(
    pageHead('Photo gallery', 'Upload photos and organise them into albums.', uploadBtn),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), statusSel), chips, bulk, gridHost, pagerHost),
  );

  async function loadAlbums() {
    try {
      const { items: albums } = await api('/api/admin/gallery/albums');
      const total = albums.reduce((a, b) => a + b.count, 0);
      const chip = (value, label, count) =>
        h('button', { class: `chip ${state.album === value ? 'active' : ''}`, onclick: () => ((state.album = value), (state.page = 1), loadAlbums(), load()) }, `${label} · ${count}`);
      chips.replaceChildren(
        ...[
          chip('', 'All', total),
          ...albums.filter((a) => a.album).map((a) => chip(a.album, a.album, a.count)),
          albums.some((a) => !a.album) && albums.some((a) => a.album) ? chip('__none', 'No album', albums.find((a) => !a.album).count) : null,
        ].filter(Boolean),
      );
      chips.hidden = albums.length < 2 && !albums.some((a) => a.album);
    } catch {
      chips.replaceChildren();
    }
  }

  const renderBulk = () => {
    bulk.hidden = !selected.size;
    bulk.replaceChildren(
      h('span', `${selected.size} selected`),
      h('button', { class: 'btn btn-sm', onclick: moveSelected }, 'Move to album…'),
      h('button', { class: 'btn btn-sm btn-danger', onclick: deleteSelected }, icon('trash'), 'Delete'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => (selected.clear(), renderGrid(), renderBulk()) }, 'Clear'),
    );
  };

  async function deleteSelected() {
    if (!(await confirmDialog({ title: `Delete ${selected.size} photo${selected.size > 1 ? 's' : ''}?`, message: 'They will be removed from the website permanently.' }))) return;
    try {
      const r = await api('/api/admin/gallery/bulk-delete', { method: 'POST', body: { ids: [...selected] } });
      toast(`${r.deleted} deleted`);
      selected.clear();
      reloadAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function moveSelected() {
    const album = prompt('Move selected photos to album (leave empty to remove from album):', state.album && state.album !== '__none' ? state.album : '');
    if (album === null) return;
    try {
      for (const id of selected) await api(`/api/admin/gallery/${id}`, { method: 'PATCH', body: { album } });
      toast('Photos moved');
      selected.clear();
      invalidateOptions();
      reloadAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const edit = async (item) => {
    const res = await openEditor({
      endpoint: '/api/admin/gallery',
      singular: 'photo',
      fields: EDIT_FIELDS,
      record: item,
      onDelete: async (r) => {
        if (!(await confirmDialog({ title: 'Delete this photo?', message: 'It will be removed from the website permanently.' }))) return false;
        await api(`/api/admin/gallery/${r.id}`, { method: 'DELETE' });
        toast('Photo deleted');
        return true;
      },
    });
    if (res) reloadAll();
  };

  function renderGrid() {
    if (!items.length) {
      const filtered = state.q || state.album || statusSel.value;
      gridHost.replaceChildren(
        emptyState({
          iconName: 'image',
          title: filtered ? 'No photos match' : 'No photos yet',
          text: filtered ? 'Try another album or search.' : 'Upload photos from events, campus and activities.',
          action: !filtered && h('button', { class: 'btn btn-primary', onclick: () => openUploader() }, icon('upload'), 'Upload photos'),
        }),
      );
      return;
    }
    gridHost.replaceChildren(
      h(
        'div',
        { class: 'media-grid' },
        items.map((it) => {
          const box = h('input', { type: 'checkbox', checked: selected.has(it.id), 'aria-label': 'Select photo' });
          box.addEventListener('change', () => {
            box.checked ? selected.add(it.id) : selected.delete(it.id);
            card.classList.toggle('selected', box.checked);
            renderBulk();
          });
          const card = h(
            'div',
            { class: `media ${selected.has(it.id) ? 'selected' : ''}` },
            h('div', { class: 'img', style: `background-image:url("${encodeURI(it.file_url)}")`, title: 'Click to view', onclick: () => lightbox({ image: it.file_url }) }),
            h('label', { class: 'check' }, box),
            h('div', { class: 'flags' }, it.is_featured ? badge('★ Featured', 'amber') : null, it.status === 'draft' ? badge('Hidden') : null),
            h(
              'div',
              { class: 'info' },
              h('div', { class: 't truncate', title: it.title || '' }, it.title || h('span', { class: 'faint' }, 'Untitled'), h('div', { class: 'cell-sub truncate' }, it.album || fmt.date(it.created_at))),
              h('button', { class: 'btn-icon', title: 'Edit', 'aria-label': 'Edit photo', onclick: () => edit(it) }, icon('edit')),
            ),
          );
          return card;
        }),
      ),
    );
  }

  let seq = 0;
  async function load() {
    const my = ++seq;
    if (!items.length) gridHost.replaceChildren(spinner());
    const sv = statusSel.value;
    const params = {
      page: state.page,
      limit: 40,
      q: state.q,
      album: state.album,
      status: sv === '1' ? undefined : sv,
      is_featured: sv === '1' ? 1 : undefined,
    };
    try {
      const data = await api(`/api/admin/gallery${qs(params)}`);
      if (my !== seq) return;
      items = data.items;
      renderGrid();
      pagerHost.replaceChildren(pager({ ...data, onPage: (p) => ((state.page = p), load()) }));
      renderBulk();
    } catch (e) {
      gridHost.replaceChildren(emptyState({ iconName: 'alert', title: 'Could not load photos', text: e.message }));
    }
  }

  const reloadAll = () => (loadAlbums(), load());

  /* ---------------------------------------------------------- multi-upload drawer */
  function openUploader() {
    let files = [];
    let busy = false;
    const d = drawer({ title: 'Upload photos', onClose: () => {} });
    d.layer.canClose = () => !busy;

    const input = h('input', { type: 'file', accept: ACCEPT.image, multiple: true, hidden: true });
    const thumbs = h('div', { class: 'thumbs' });
    const zone = h(
      'div',
      { class: 'dropzone', tabindex: '0', role: 'button', onclick: () => input.click(), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && input.click() },
      h('span', { class: 'big' }, icon('upload')),
      h('strong', 'Drop photos here or click to choose'),
      h('span', { class: 'muted' }, `JPG, PNG, WEBP, GIF · up to ${limits.imageMb} MB each · 50 at a time`),
    );
    const count = h('div', { class: 'muted', style: 'margin-top:10px' });

    const renderThumbs = () => {
      for (const t of thumbs.querySelectorAll('[data-url]')) URL.revokeObjectURL(t.dataset.url);
      thumbs.replaceChildren(
        ...files.map((f, i) => {
          const url = URL.createObjectURL(f);
          return h('div', { dataset: { url }, style: `background-image:url("${url}")`, title: f.name }, h('button', { type: 'button', 'aria-label': 'Remove', onclick: () => (files.splice(i, 1), renderThumbs()) }, '✕'));
        }),
      );
      count.textContent = files.length ? `${files.length} photo${files.length > 1 ? 's' : ''} · ${fmt.bytes(files.reduce((a, f) => a + f.size, 0))}` : '';
      save.disabled = !files.length;
    };
    const add = (list) => {
      const ok = [...list].filter((f) => /^image\/(jpeg|png|webp|gif|avif)$/.test(f.type));
      const tooBig = ok.filter((f) => f.size > limits.imageMb * 1024 * 1024);
      if (ok.length < list.length) toast('Some files were skipped (not a supported image type).', 'error');
      if (tooBig.length) toast(`${tooBig.length} file(s) larger than ${limits.imageMb} MB were skipped.`, 'error');
      files = [...files, ...ok.filter((f) => !tooBig.includes(f))].slice(0, 50);
      renderThumbs();
    };
    input.addEventListener('change', () => (add(input.files), (input.value = '')));
    for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => (e.preventDefault(), zone.classList.add('drag')));
    for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => (e.preventDefault(), add(e.dataTransfer.files)));

    const form = buildForm(
      [
        { name: 'album', label: 'Album', datalist: 'gallery/album', placeholder: 'e.g. Sports Day 2026', span: 2, help: 'Photos with the same album name are grouped together.' },
        { name: 'caption', label: 'Caption (applies to all)', type: 'textarea', rows: 2, span: 2 },
        { name: 'status', label: 'Visibility', type: 'select', options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Hidden' }] },
        { name: 'is_featured', type: 'toggle', toggleLabel: 'Feature on the homepage' },
      ],
      { album: state.album && state.album !== '__none' ? state.album : '' },
    );

    d.body.append(zone, input, thumbs, count, h('div', { style: 'height:20px' }), form.el);
    const bar = h('div', { class: 'progress', style: 'flex:1;max-width:240px', hidden: true }, h('div'));
    const pct = h('span', { class: 'muted', style: 'font-size:12.5px' });
    const save = h('button', { class: 'btn btn-primary', disabled: true }, icon('upload'), 'Upload');
    d.foot.append(h('div', { class: 'left' }, bar, pct), h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'), save);

    save.addEventListener('click', async () => {
      if (!files.length || busy) return;
      busy = true;
      setLoading(save, true);
      bar.hidden = false;
      const fd = form.toFormData();
      for (const f of files) fd.append('files', f);
      try {
        const r = await upload('/api/admin/gallery', fd, {
          onProgress: (p) => {
            bar.firstChild.style.width = `${Math.round(p * 100)}%`;
            pct.textContent = p < 1 ? `Uploading ${Math.round(p * 100)}%` : 'Saving…';
          },
        });
        toast(`${r.items.length} photo${r.items.length > 1 ? 's' : ''} uploaded`);
        invalidateOptions();
        busy = false;
        d.close();
        reloadAll();
      } catch (e) {
        busy = false;
        setLoading(save, false);
        bar.hidden = true;
        pct.textContent = '';
        toast(e.message, 'error');
      }
    });
  }

  reloadAll();
  if (ctx.query.new) openUploader();
}
