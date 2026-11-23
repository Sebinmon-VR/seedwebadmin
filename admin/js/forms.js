import { h, icon, fmt, toast } from './ui.js';
import { api, upload } from './api.js';

export const ACCEPT = {
  image: 'image/jpeg,image/png,image/webp,image/gif,image/avif',
  video: 'video/mp4,video/webm,video/quicktime,.m4v,.ogv',
  file: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp',
};

/** Server-provided limits (filled in by app.js from /api/admin/meta). */
export const limits = { imageMb: 10, videoMb: 300, fileMb: 20 };
const limitFor = (type) => ({ image: limits.imageMb, video: limits.videoMb, file: limits.fileMb })[type];

const datalistCache = new Map();
async function loadOptions(src) {
  if (!datalistCache.has(src)) datalistCache.set(src, api(`/api/admin/options/${src}`).then((r) => r.items).catch(() => []));
  return datalistCache.get(src);
}
export const invalidateOptions = () => datalistCache.clear();

let uid = 0;

/**
 * Build a form from field definitions.
 * field: { name, label, type, required, placeholder, help, span: 2, options, rows, datalist: 'table/field',
 *          showIf: (values) => bool, toggleLabel }
 * types: text email url number textarea richtext select segmented toggle datetime date image video file section
 */
export function buildForm(fields, initial = {}) {
  const controls = new Map();
  const grid = h('div', { class: 'form-grid' });

  for (const f of fields) {
    if (f.type === 'section') {
      grid.append(h('div', { class: 'form-section' }, f.label));
      continue;
    }
    const id = `f${++uid}`;
    const ctl = makeControl(f, initial, id);
    const errorEl = h('div', { class: 'error', hidden: true });
    const wrap = h(
      'div',
      { class: `field ${f.span === 2 || ['richtext', 'image', 'video', 'file'].includes(f.type) ? 'span-2' : ''}` },
      f.type !== 'toggle' && f.label && h('label', { for: id }, f.label, f.required && h('span', { class: 'req' }, '*')),
      ctl.el,
      f.help && h('div', { class: 'help' }, f.help),
      errorEl,
    );
    controls.set(f.name, { ...ctl, f, wrap, errorEl });
    grid.append(wrap);
  }

  const values = () => Object.fromEntries([...controls].map(([k, c]) => [k, c.get()]));
  const applyVisibility = () => {
    const v = values();
    for (const c of controls.values()) if (c.f.showIf) c.wrap.hidden = !c.f.showIf(v);
  };
  grid.addEventListener('input', applyVisibility);
  grid.addEventListener('change', applyVisibility);
  applyVisibility();

  const visible = () => [...controls.values()].filter((c) => !c.wrap.hidden);

  return {
    el: grid,
    values,
    control: (name) => controls.get(name),
    clearErrors() {
      for (const c of controls.values()) {
        c.wrap.classList.remove('has-error');
        c.errorEl.hidden = true;
      }
    },
    setErrors(fieldErrors = {}, message) {
      this.clearErrors();
      let first;
      for (const [name, msg] of Object.entries(fieldErrors)) {
        const c = controls.get(name);
        if (!c) continue;
        c.wrap.classList.add('has-error');
        c.errorEl.textContent = msg.length > 12 ? msg : message || 'Please check this field.';
        c.errorEl.hidden = false;
        first ||= c;
      }
      first?.wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return !!first;
    },
    /** Client-side required check; returns true when valid. */
    validate() {
      const errs = {};
      for (const c of visible()) {
        if (!c.f.required) continue;
        if (c.isFile ? !c.hasFile() : !String(c.get() ?? '').trim()) errs[c.f.name] = `${c.f.label} is required.`;
      }
      return !this.setErrors(errs);
    },
    toFormData() {
      const fd = new FormData();
      for (const c of visible()) c.append(fd);
      return fd;
    },
    hasFiles: () => visible().some((c) => c.isFile && c.file()),
    focusFirst() {
      const el = grid.querySelector('input:not([type=hidden]):not([type=file]), textarea, select, [contenteditable]');
      setTimeout(() => el?.focus(), 250);
    },
  };
}

function makeControl(f, initial, id) {
  const v = initial[f.name];
  switch (f.type) {
    case 'textarea': {
      const el = h('textarea', { id, class: 'textarea', rows: f.rows || 4, placeholder: f.placeholder || '', value: v ?? '' });
      return simple(el, f);
    }
    case 'select': {
      const el = h('select', { id, class: 'select' }, f.options.map((o) => h('option', { value: o.value ?? o }, o.label ?? o)));
      el.value = v ?? f.default ?? (f.options[0]?.value ?? f.options[0]);
      return simple(el, f);
    }
    case 'segmented': {
      const name = `seg${id}`;
      const cur = v ?? f.default ?? f.options[0].value;
      const el = h(
        'div',
        { class: 'segmented', id },
        f.options.map((o) => h('label', h('input', { type: 'radio', name, value: o.value, checked: o.value === cur }), o.label)),
      );
      const get = () => el.querySelector('input:checked')?.value ?? '';
      return { el, get, append: (fd) => fd.set(f.name, get()) };
    }
    case 'toggle': {
      const input = h('input', { type: 'checkbox', id, checked: !!(v ?? f.default) });
      const el = h('label', { class: 'toggle' }, input, h('span', { class: 'track' }), h('span', f.toggleLabel || f.label));
      return { el, get: () => input.checked, append: (fd) => fd.set(f.name, input.checked ? '1' : '0') };
    }
    case 'datetime': {
      const el = h('input', { id, type: 'datetime-local', class: 'input', value: fmt.toLocalInput(v) });
      return { el, get: () => el.value, append: (fd) => fd.set(f.name, fmt.fromLocalInput(el.value)) };
    }
    case 'date':
      return simple(h('input', { id, type: 'date', class: 'input', value: v ?? '' }), f);
    case 'richtext':
      return richText(f, v, id);
    case 'image':
    case 'video':
    case 'file':
      return filePicker(f, initial, id);
    default: {
      const el = h('input', {
        id,
        type: ['email', 'url', 'number'].includes(f.type) ? f.type : 'text',
        class: 'input',
        placeholder: f.placeholder || '',
        value: v ?? '',
        autocomplete: 'off',
      });
      if (f.datalist) {
        const listId = `${id}-list`;
        el.setAttribute('list', listId);
        const dl = h('datalist', { id: listId });
        loadOptions(f.datalist).then((items) => dl.append(...items.map((i) => h('option', { value: i }))));
        return { ...simple(el, f), el: h('div', el, dl) };
      }
      return simple(el, f);
    }
  }
}

function simple(el, f) {
  return { el, get: () => el.value, append: (fd) => fd.set(f.name, el.value.trim()) };
}

/* ------------------------------------------------------------------ file picker */

function filePicker(f, initial, id) {
  const existingUrl = initial[`${f.name}_url`] || null;
  const existingName = initial[`${f.name}_name`] || (existingUrl ? decodeURIComponent(existingUrl.split('/').pop()) : '');
  let file = null;
  let removed = false;

  const input = h('input', { type: 'file', id, accept: ACCEPT[f.type], hidden: true });
  const preview = h('div', { class: 'preview' });
  const name = h('div', { class: 'name truncate' });
  const sub = h('div', { class: 'help' });
  const chooseBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => input.click() }, icon('upload'));
  const removeBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, icon('trash'), 'Remove');
  const box = h('div', { class: 'filebox' }, preview, h('div', { class: 'meta' }, name, sub, h('div', { class: 'acts' }, chooseBtn, removeBtn)), input);

  let objectUrl;
  const render = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    preview.replaceChildren();
    const src = file ? (objectUrl = URL.createObjectURL(file)) : !removed ? existingUrl : null;
    if (src && f.type === 'image') preview.append(h('img', { src, alt: '' }));
    else if (src && f.type === 'video') preview.append(h('video', { src, muted: true, preload: 'metadata' }));
    else preview.append(icon(f.type === 'image' ? 'image' : f.type === 'video' ? 'video' : 'clip'));

    if (file) {
      name.textContent = file.name;
      sub.textContent = `${fmt.bytes(file.size)} · will upload when you save`;
    } else if (existingUrl && !removed) {
      name.replaceChildren(h('a', { href: existingUrl, target: '_blank', rel: 'noopener' }, existingName || 'Current file'));
      sub.textContent = 'Current file';
    } else {
      name.textContent = 'No file chosen';
      sub.textContent = `Drag & drop or choose a file · max ${limitFor(f.type)} MB`;
    }
    chooseBtn.lastChild?.nodeType === 3 && chooseBtn.lastChild.remove();
    chooseBtn.append(file || (existingUrl && !removed) ? 'Replace' : 'Choose file');
    removeBtn.hidden = !(file || (existingUrl && !removed));
  };

  const take = (fl) => {
    if (!fl) return;
    const max = limitFor(f.type) * 1024 * 1024;
    if (fl.size > max) return toast(`"${fl.name}" is larger than ${limitFor(f.type)} MB.`, 'error');
    file = fl;
    removed = false;
    render();
    box.dispatchEvent(new Event('change', { bubbles: true }));
  };

  input.addEventListener('change', () => take(input.files[0]));
  removeBtn.addEventListener('click', () => {
    if (file) file = null;
    else removed = true;
    input.value = '';
    render();
  });
  for (const ev of ['dragenter', 'dragover']) box.addEventListener(ev, (e) => (e.preventDefault(), box.classList.add('drag')));
  for (const ev of ['dragleave', 'drop']) box.addEventListener(ev, () => box.classList.remove('drag'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    take(e.dataTransfer.files[0]);
  });
  render();

  return {
    el: box,
    isFile: true,
    file: () => file,
    hasFile: () => !!file || (!!existingUrl && !removed),
    get: () => (file ? file.name : !removed ? existingUrl : ''),
    append(fd) {
      if (file) fd.set(f.name, file);
      else if (removed && existingUrl) fd.set(`remove_${f.name}`, '1');
    },
  };
}

/* ------------------------------------------------------------------ rich text */

function richText(f, value, id) {
  const body = h('div', { class: 'editor-body', id, contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'data-placeholder': f.placeholder || 'Start writing…' });
  body.innerHTML = value || '';
  let saved = null;

  const saveRange = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && body.contains(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    body.focus();
    if (saved) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(saved);
    }
  };
  const exec = (cmd, arg) => {
    restoreRange();
    document.execCommand(cmd, false, arg);
    saveRange();
    body.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const imgInput = h('input', { type: 'file', accept: ACCEPT.image, hidden: true });
  imgInput.addEventListener('change', async () => {
    const fl = imgInput.files[0];
    imgInput.value = '';
    if (!fl) return;
    const fd = new FormData();
    fd.set('file', fl);
    try {
      toast('Uploading image…');
      const { url } = await upload('/api/admin/uploads/image', fd);
      exec('insertImage', url);
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  const B = (label, title, fn) =>
    h('button', { type: 'button', title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: fn }, label);
  const sep = () => h('span', { class: 'sep' });
  const bar = h(
    'div',
    { class: 'editor-bar' },
    B(h('b', 'B'), 'Bold', () => exec('bold')),
    B(h('i', 'I'), 'Italic', () => exec('italic')),
    B(h('u', 'U'), 'Underline', () => exec('underline')),
    sep(),
    B('H2', 'Heading', () => exec('formatBlock', '<h2>')),
    B('H3', 'Sub-heading', () => exec('formatBlock', '<h3>')),
    B('¶', 'Normal text', () => exec('formatBlock', '<p>')),
    sep(),
    B('• List', 'Bulleted list', () => exec('insertUnorderedList')),
    B('1. List', 'Numbered list', () => exec('insertOrderedList')),
    B(icon('quote'), 'Quote', () => exec('formatBlock', '<blockquote>')),
    sep(),
    B(icon('link'), 'Add link', () => {
      saveRange();
      let url = prompt('Link address (https://…)');
      if (!url) return;
      if (!/^(https?:|mailto:|tel:)/i.test(url)) url = `https://${url}`;
      exec('createLink', url);
    }),
    B(icon('image'), 'Insert image', () => {
      saveRange();
      imgInput.click();
    }),
    sep(),
    B('Tx', 'Clear formatting', () => {
      exec('removeFormat');
      exec('unlink');
    }),
    imgInput,
  );

  body.addEventListener('keyup', saveRange);
  body.addEventListener('mouseup', saveRange);
  body.addEventListener('focus', () => document.execCommand('defaultParagraphSeparator', false, 'p'));

  const get = () => {
    const html = body.innerHTML.trim();
    return html === '<br>' || html === '<p><br></p>' ? '' : html;
  };
  return { el: h('div', { class: 'editor' }, bar, body), get, append: (fd) => fd.set(f.name, get()) };
}
