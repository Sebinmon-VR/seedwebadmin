import { h, icon, badge, fmt, toast, lightbox } from '../ui.js';
import { api } from '../api.js';
import { resourcePage, mainCell } from '../resource.js';

const statusBadge = (s) => (s === 'published' ? badge('Published', 'green') : s === 'cancelled' ? badge('Cancelled', 'red') : badge('Draft'));
const STATUS_OPTIONS = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
];

/* ------------------------------------------------------------------ posts */

export const posts = resourcePage({
  title: 'Posts',
  description: 'News, articles and announcements shown on the website.',
  endpoint: '/api/admin/posts',
  singular: 'post',
  plural: 'posts',
  emptyIcon: 'file',
  emptyText: 'Write news, achievements or announcements for your website.',
  searchPlaceholder: 'Search posts…',
  wide: true,
  defaults: { status: 'published' },
  filters: [{ name: 'status', placeholder: 'All statuses', options: STATUS_OPTIONS }],
  columns: [
    {
      label: 'Post',
      render: (r) => mainCell({ thumb: r.cover_image_url, iconName: 'file', title: r.title, sub: [r.category, r.excerpt].filter(Boolean).join(' · ') || `/${r.slug}` }),
    },
    { label: 'Status', render: (r) => statusBadge(r.status) },
    { label: 'Published', class: 'hide-sm nowrap', render: (r) => (r.published_at ? fmt.date(r.published_at) : h('span', { class: 'faint' }, '—')) },
    { label: 'Updated', class: 'hide-sm nowrap muted', render: (r) => fmt.relative(r.updated_at) },
  ],
  fields: [
    { name: 'title', label: 'Title', required: true, span: 2, placeholder: 'e.g. Annual Sports Day 2026 highlights' },
    { name: 'category', label: 'Category', datalist: 'posts/category', placeholder: 'e.g. News, Achievements' },
    { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
    { name: 'published_at', label: 'Publish date', type: 'datetime', help: 'Leave empty to use the time you publish. A future date schedules the post.' },
    { name: 'slug', label: 'URL slug', placeholder: 'auto-generated from title', help: 'Used in the post link on the website.' },
    { name: 'cover_image', label: 'Cover image', type: 'image' },
    { name: 'excerpt', label: 'Short summary', type: 'textarea', rows: 2, span: 2, placeholder: 'One or two lines shown in post listings' },
    { name: 'content', label: 'Content', type: 'richtext', placeholder: 'Write your post…' },
  ],
});

/* ------------------------------------------------------------------ videos */

export const videos = resourcePage({
  title: 'Videos',
  description: 'Upload video files or add YouTube, Vimeo and Facebook links.',
  endpoint: '/api/admin/videos',
  singular: 'video',
  plural: 'videos',
  emptyIcon: 'video',
  emptyText: 'Upload a video or paste a YouTube link to get started.',
  searchPlaceholder: 'Search videos…',
  defaults: { source: 'link', status: 'published' },
  filters: [
    { name: 'source', placeholder: 'All sources', options: [{ value: 'upload', label: 'Uploaded' }, { value: 'link', label: 'Links' }] },
    { name: 'status', placeholder: 'All statuses', options: STATUS_OPTIONS },
  ],
  columns: [
    {
      label: 'Video',
      render: (r) =>
        mainCell({
          thumb: r.thumbnail_url,
          iconName: 'video',
          title: r.title,
          sub: r.category || (r.source === 'link' ? r.url : 'Uploaded file'),
          extra: r.is_featured ? h('span', { title: 'Featured', style: 'color:#d97706;margin-left:6px' }, icon('star')) : null,
        }),
    },
    { label: 'Source', render: (r) => (r.source === 'upload' ? badge('Uploaded', 'blue') : badge(r.embed_url ? hostName(r.url) : 'Link', 'purple')) },
    { label: 'Status', render: (r) => statusBadge(r.status) },
    { label: 'Added', class: 'hide-sm nowrap muted', render: (r) => fmt.date(r.created_at) },
  ],
  rowActions: (r) =>
    h('button', {
      class: 'btn-icon',
      title: 'Preview',
      'aria-label': 'Preview',
      onclick: () => (r.source === 'upload' ? lightbox({ video: r.file_url }) : r.embed_url ? lightbox({ embed: r.embed_url }) : window.open(r.url, '_blank', 'noopener')),
    }, icon('play')),
  fields: [
    { name: 'title', label: 'Title', required: true, span: 2 },
    {
      name: 'source',
      label: 'Video source',
      type: 'segmented',
      span: 2,
      options: [
        { value: 'link', label: 'YouTube / Vimeo / link' },
        { value: 'upload', label: 'Upload a file' },
      ],
    },
    { name: 'url', label: 'Video link', type: 'url', span: 2, required: true, placeholder: 'https://www.youtube.com/watch?v=…', help: 'YouTube, Vimeo, Facebook or a direct .mp4 link.', showIf: (v) => v.source === 'link' },
    { name: 'file', label: 'Video file', type: 'video', required: true, showIf: (v) => v.source === 'upload' },
    { name: 'thumbnail', label: 'Thumbnail (optional)', type: 'image', help: 'YouTube links get a thumbnail automatically.' },
    { name: 'description', label: 'Description', type: 'textarea', rows: 3, span: 2 },
    { name: 'category', label: 'Category', datalist: 'videos/category' },
    { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
    { name: 'is_featured', type: 'toggle', toggleLabel: 'Feature on the homepage' },
  ],
});

function hostName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
    return host.includes('youtu') ? 'YouTube' : host.includes('vimeo') ? 'Vimeo' : host.includes('facebook') || host === 'fb.watch' ? 'Facebook' : host;
  } catch {
    return 'Link';
  }
}

/* ------------------------------------------------------------------ events */

export const stateBadge = (s) =>
  ({ live: badge('Live now', 'live'), upcoming: badge('Upcoming', 'blue'), past: badge('Past'), cancelled: badge('Cancelled', 'red') })[s] || badge(s);

export const events = resourcePage({
  title: 'Events & live',
  description: 'Upcoming events, live streams and past programmes.',
  endpoint: '/api/admin/events',
  singular: 'event',
  plural: 'events',
  emptyIcon: 'calendar',
  emptyText: 'Add events and live streams so visitors know what’s happening.',
  searchPlaceholder: 'Search events…',
  defaults: { status: 'published' },
  filters: [
    { name: 'when', placeholder: 'All dates', options: [{ value: 'live', label: 'Live now' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }] },
    { name: 'status', placeholder: 'All statuses', options: [...STATUS_OPTIONS, { value: 'cancelled', label: 'Cancelled' }] },
  ],
  columns: [
    {
      label: 'Event',
      render: (r) => {
        const d = new Date(r.start_at);
        return h(
          'div',
          { class: 'cell-main' },
          h('div', { class: 'date-chip' }, h('span', d.toLocaleDateString(undefined, { month: 'short' })), h('b', d.getDate())),
          h('div', { style: 'min-width:0' }, h('div', { class: 'cell-title' }, r.title), h('div', { class: 'cell-sub truncate' }, [fmt.time(r.start_at), r.venue].filter(Boolean).join(' · '))),
        );
      },
    },
    { label: 'When', render: (r) => stateBadge(r.state) },
    { label: 'Live stream', class: 'hide-sm', render: (r) => (r.live_url ? h('a', { href: r.live_url, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, icon('live'), ' Stream link') : h('span', { class: 'faint' }, '—')) },
    { label: 'Status', class: 'hide-sm', render: (r) => statusBadge(r.status) },
  ],
  rowActions: (r, reload) =>
    r.status !== 'cancelled' &&
    (r.is_live || r.state !== 'live') &&
    h('button', {
      class: `btn btn-sm ${r.is_live ? 'btn-danger' : ''}`,
      title: r.is_live ? 'Stop showing as live' : 'Show as LIVE NOW on the website',
      onclick: async () => {
        try {
          await api(`/api/admin/events/${r.id}`, { method: 'PATCH', body: { is_live: !r.is_live } });
          toast(r.is_live ? 'Live ended' : `"${r.title}" is now live`);
          reload();
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    }, icon('live'), r.is_live ? 'End live' : 'Go live'),
  fields: [
    { name: 'title', label: 'Event title', required: true, span: 2, placeholder: 'e.g. Annual Day Celebration' },
    { name: 'start_at', label: 'Starts', type: 'datetime', required: true },
    { name: 'end_at', label: 'Ends', type: 'datetime' },
    { name: 'venue', label: 'Venue', span: 2, placeholder: 'e.g. Main Auditorium' },
    { name: 'cover_image', label: 'Cover image', type: 'image' },
    { name: 'description', label: 'Description', type: 'textarea', rows: 4, span: 2 },
    { type: 'section', label: 'Live streaming' },
    { name: 'live_url', label: 'Live stream link', type: 'url', span: 2, placeholder: 'https://www.youtube.com/live/…', help: 'YouTube Live, Facebook Live, Zoom or any stream link.' },
    { name: 'is_live', type: 'toggle', toggleLabel: 'Show as LIVE NOW', help: 'Events are also shown as live automatically between their start and end time.' },
    { name: 'status', label: 'Status', type: 'select', options: [...STATUS_OPTIONS, { value: 'cancelled', label: 'Cancelled' }] },
  ],
});

/* ------------------------------------------------------------------ notices */

function noticeVisibility(n) {
  const now = new Date().toISOString();
  if (n.status !== 'published') return badge('Draft');
  if (n.publish_at && n.publish_at > now) return badge(`Scheduled · ${fmt.date(n.publish_at)}`, 'blue');
  if (n.expires_at && n.expires_at <= now) return badge('Expired');
  return badge('Showing', 'green');
}

const PRIORITY = [
  { value: 'normal', label: 'Normal' },
  { value: 'important', label: 'Important' },
  { value: 'urgent', label: 'Urgent' },
];

export const notices = resourcePage({
  title: 'Notices',
  description: 'Circulars, holidays, exam schedules and other announcements.',
  endpoint: '/api/admin/notices',
  singular: 'notice',
  plural: 'notices',
  emptyIcon: 'megaphone',
  emptyText: 'Publish notices with optional PDF attachments, schedule and expiry dates.',
  searchPlaceholder: 'Search notices…',
  defaults: { status: 'published', priority: 'normal' },
  filters: [
    { name: 'priority', placeholder: 'All priorities', options: PRIORITY },
    { name: 'status', placeholder: 'All statuses', options: STATUS_OPTIONS },
  ],
  columns: [
    {
      label: 'Notice',
      render: (r) =>
        h(
          'div',
          { style: 'min-width:220px' },
          h('div', { class: 'cell-title' }, r.is_pinned ? h('span', { title: 'Pinned', style: 'color:var(--accent);margin-right:6px' }, icon('pin')) : null, r.title),
          h('div', { class: 'cell-sub' }, [r.category, r.attachment_name && `📎 ${r.attachment_name}`, r.show_in_ticker && 'In ticker'].filter(Boolean).join(' · ') || fmt.date(r.created_at)),
        ),
    },
    { label: 'Priority', render: (r) => (r.priority === 'urgent' ? badge('Urgent', 'red') : r.priority === 'important' ? badge('Important', 'amber') : badge('Normal')) },
    { label: 'Visibility', render: noticeVisibility },
    { label: 'Hide after', class: 'hide-sm nowrap muted', render: (r) => (r.expires_at ? fmt.date(r.expires_at) : '—') },
  ],
  fields: [
    { name: 'title', label: 'Title', required: true, span: 2, placeholder: 'e.g. School closed on Friday for Diwali' },
    { name: 'body', label: 'Details', type: 'textarea', rows: 5, span: 2 },
    { name: 'category', label: 'Category', datalist: 'notices/category', placeholder: 'e.g. Holiday, Exam, Circular' },
    { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY },
    { name: 'publish_at', label: 'Show from', type: 'datetime', help: 'Leave empty to show immediately.' },
    { name: 'expires_at', label: 'Hide after', type: 'datetime', help: 'Leave empty to keep it showing.' },
    { name: 'attachment', label: 'Attachment (PDF, Word, Excel or image)', type: 'file' },
    { name: 'is_pinned', type: 'toggle', toggleLabel: 'Pin to top' },
    { name: 'show_in_ticker', type: 'toggle', toggleLabel: 'Show in scrolling ticker' },
    { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
  ],
});
