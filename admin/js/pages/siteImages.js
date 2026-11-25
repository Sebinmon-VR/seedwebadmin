import { h, icon, badge, toast, confirmDialog, spinner, emptyState, debounce, lightbox, fmt } from '../ui.js';
import { api, upload } from '../api.js';
import { ACCEPT, limits } from '../forms.js';
import { pageHead } from '../resource.js';

/**
 * Website images: every picture built into the website (read from the website's
 * site-images.json). Replace any of them here; Reset goes back to the original.
 */
export function siteImages(root) {
  const state = { q: '', show: 'all', data: null };

  const refreshBtn = h('button', { class: 'btn', onclick: () => load(true) }, icon('refresh'), 'Refresh list');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search pictures…', 'aria-label': 'Search pictures' });
  search.addEventListener('input', debounce(() => ((state.q = search.value.trim().toLowerCase()), render()), 200));
  const showSel = h(
    'select',
    { class: 'select', 'aria-label': 'Show' },
    h('option', { value: 'all' }, 'All pictures'),
    h('option', { value: 'replaced' }, 'Replaced'),
    h('option', { value: 'original' }, 'Original'),
  );
  showSel.addEventListener('change', () => ((state.show = showSel.value), render()));
  const summary = h('span', { class: 'muted', style: 'font-size:13px' });
  const notice = h('div');
  const host = h('div', spinner());

  root.append(
    pageHead('Website images', 'Every picture on your website. Replace one and the website shows the new picture within a minute. Reset brings back the original.', refreshBtn),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), showSel, h('span', { class: 'spacer' }), summary), notice, host),
  );

  async function load(refresh = false) {
    if (refresh) host.replaceChildren(spinner());
    try {
      state.data = await api(`/api/admin/site-images${refresh ? '?refresh=1' : ''}`);
    } catch (e) {
      host.replaceChildren(emptyState({ iconName: 'alert', title: 'Could not load the pictures', text: e.message }));
      return;
    }
    render();
  }

  function render() {
    const { error, website_url: site, items } = state.data;
    notice.replaceChildren();
    if (error === 'missing') {
      summary.textContent = '';
      host.replaceChildren(
        emptyState({
          iconName: 'layout',
          title: 'Add your website’s address first',
          text: 'The panel reads the list of pictures from your website. Enter its address (for example https://www.yourschool.com) in Website settings.',
          action: h('a', { class: 'btn btn-primary', href: '#/settings' }, 'Open Website settings'),
        }),
      );
      return;
    }
    if (error) notice.append(h('div', { class: 'alert', style: 'margin:12px 14px 0' }, error, ' Pictures you already replaced are still listed.'));
    else if (site) notice.append(h('p', { class: 'muted si-source' }, 'Pictures on ', h('a', { href: site, target: '_blank', rel: 'noopener' }, site.replace(/^https?:\/\//, '')), '.'));

    const replaced = items.filter((i) => i.url).length;
    summary.textContent = `${items.length} picture${items.length === 1 ? '' : 's'} · ${replaced} replaced`;

    const shown = items.filter((i) => {
      if (state.show === 'replaced' && !i.url) return false;
      if (state.show === 'original' && i.url) return false;
      if (!state.q) return true;
      return [i.label, i.key, ...i.pages].some((s) => String(s).toLowerCase().includes(state.q));
    });
    if (!shown.length) {
      host.replaceChildren(emptyState({ iconName: 'image', title: items.length ? 'No pictures match' : 'No pictures found', text: items.length ? 'Try another search.' : 'The website did not list any pictures.' }));
      return;
    }
    const groups = new Map();
    for (const i of shown) groups.set(i.group, [...(groups.get(i.group) || []), i]);
    host.replaceChildren(
      ...[...groups].map(([group, list]) =>
        h('section', { class: 'si-group' }, h('h2', group, h('span', { class: 'muted' }, ` · ${list.length}`)), h('div', { class: 'media-grid' }, list.map(card))),
      ),
    );
  }

  function card(item) {
    const current = item.url || item.default_url;
    const input = h('input', { type: 'file', accept: ACCEPT.image, hidden: true });
    const replaceBtn = h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => input.click() }, icon('upload'), item.url ? 'Replace again' : 'Replace');
    const resetBtn = item.url && h('button', { class: 'btn btn-sm', type: 'button', title: 'Go back to the original picture', onclick: () => reset(item) }, icon('undo'), 'Reset');
    const bar = h('i');
    const progress = h('div', { class: 'si-progress', hidden: true }, bar);
    const dims = h('span');
    // logos are transparent PNGs drawn for the dark footer: show them on dark green, uncropped
    const transparent = /\.png(\?|$)/i.test(current || '');
    const thumb = current
      ? h('button', { class: `si-img${transparent ? ' si-img--dark' : ''}`, type: 'button', title: 'View larger', onclick: () => lightbox({ image: current }) }, h('img', { src: current, alt: '', loading: 'lazy', decoding: 'async' }))
      : h('div', { class: 'si-img si-img--none' }, icon('image'));
    if (item.default_url) {
      const probe = new Image();
      probe.onload = () => (dims.textContent = `Original ${probe.naturalWidth} × ${probe.naturalHeight} px`);
      probe.src = item.default_url;
    }

    const el = h(
      'div',
      { class: `media si-card${item.url ? ' is-replaced' : ''}` },
      thumb,
      h('div', { class: 'flags' }, item.url ? badge('Replaced', 'green') : badge('Original')),
      h(
        'div',
        { class: 'si-body' },
        h('div', { class: 'si-label', title: item.key }, item.label),
        h('div', { class: 'si-meta' }, item.on_website ? `On: ${item.pages.join(', ') || '—'}` : 'No longer used on the website'),
        h('div', { class: 'si-meta' }, dims, item.url && ` · replaced ${fmt.relative(item.updated_at)}`),
        h('div', { class: 'si-actions' }, replaceBtn, resetBtn, input),
        progress,
      ),
    );

    const send = async (file) => {
      if (!file) return;
      if (!ACCEPT.image.split(',').includes(file.type)) return toast('Choose a JPG, PNG, WEBP, GIF or AVIF image.', 'error');
      if (file.size > limits.imageMb * 1024 * 1024) return toast(`That image is too large (max ${limits.imageMb} MB).`, 'error');
      const fd = new FormData();
      fd.append('key', item.key);
      fd.append('file', file);
      progress.hidden = false;
      replaceBtn.disabled = true;
      try {
        const saved = await upload('/api/admin/site-images/replace', fd, { onProgress: (p) => (bar.style.width = `${Math.round(p * 100)}%`) });
        Object.assign(item, { url: saved.url, original_name: saved.original_name, updated_at: saved.updated_at });
        toast('Picture replaced. The website shows it within a minute.');
        render();
      } catch (e) {
        toast(e.message, 'error');
        progress.hidden = true;
        replaceBtn.disabled = false;
      }
    };
    input.addEventListener('change', () => send(input.files[0]));
    el.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      el.classList.add('is-drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-drop'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('is-drop');
      send(e.dataTransfer.files[0]);
    });
    return el;
  }

  async function reset(item) {
    if (!(await confirmDialog({ title: 'Go back to the original picture?', message: `“${item.label}” will show the website’s built-in picture again.`, confirmText: 'Reset', danger: false }))) return;
    try {
      await api('/api/admin/site-images/reset', { method: 'POST', body: { key: item.key } });
      toast('Original picture restored');
      if (item.on_website) Object.assign(item, { url: null, updated_at: null });
      else state.data.items.splice(state.data.items.indexOf(item), 1);
      render();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  load();
}
