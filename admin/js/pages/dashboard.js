import { h, icon, fmt, spinner, emptyState, badge } from '../ui.js';
import { api } from '../api.js';
import { statusBadge } from './enquiries.js';

export async function dashboard(root, ctx) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const head = h('div', { class: 'page-head' }, h('div', h('h1', `${greet}, ${ctx.user.name.split(' ')[0]}`), h('p', 'Here’s what’s happening on your website.')));
  const body = h('div', spinner());
  root.append(head, body);

  let d;
  try {
    d = await api('/api/admin/dashboard');
  } catch (e) {
    body.replaceChildren(emptyState({ iconName: 'alert', title: 'Could not load the dashboard', text: e.message }));
    return;
  }
  const c = d.counts;

  const stat = (href, iconName, tone, value, label, sub) =>
    h('a', { class: 'card stat', href }, h('div', { class: `stat-icon ${tone}` }, icon(iconName)), h('div', h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label), sub && h('div', { class: 'stat-sub' }, sub)));

  const max = Math.max(1, ...d.enquiries_by_day.map((x) => x.count));
  const chart = h(
    'div',
    { class: 'chart', role: 'img', 'aria-label': 'Enquiries per day, last 14 days' },
    d.enquiries_by_day.map((x, i) =>
      h(
        'div',
        { class: 'bar', title: `${fmt.date(`${x.date}T12:00:00Z`)}: ${x.count} enquir${x.count === 1 ? 'y' : 'ies'}` },
        x.count ? h('small', x.count) : null,
        h('i', { class: x.count ? '' : 'zero', style: `height:${Math.max(2, (x.count / max) * 88)}%` }),
        h('small', i % 2 === 1 ? '' : new Date(`${x.date}T12:00:00Z`).getDate()),
      ),
    ),
  );

  const quick = (href, iconName, label) => h('a', { href }, icon(iconName), label);

  body.replaceChildren(
    d.live_events.length
      ? h(
          'div',
          { class: 'live-banner' },
          badge('Live now', 'live'),
          h('strong', d.live_events.map((e) => e.title).join(', ')),
          h('span', { style: 'flex:1' }),
          h('a', { class: 'btn btn-sm', href: '#/events?when=live' }, 'Manage live events'),
        )
      : null,
    h(
      'div',
      { class: 'stats' },
      stat('#/enquiries?status=new', 'inbox', 'green', c.enquiries_new, 'New enquiries', `${c.enquiries_week} this week · ${c.enquiries_total} total`),
      stat('#/events?when=upcoming', 'calendar', 'blue', c.events_upcoming, 'Upcoming events', c.events_live ? `${c.events_live} live now` : 'None live right now'),
      stat('#/posts', 'file', 'purple', c.posts_published, 'Published posts', c.posts_draft ? `${c.posts_draft} draft${c.posts_draft > 1 ? 's' : ''}` : 'No drafts'),
      stat('#/notices', 'megaphone', 'amber', c.notices_active, 'Active notices', `${c.images} photos · ${c.videos} videos`),
    ),
    h(
      'div',
      { class: 'dash-grid' },
      h(
        'div',
        { class: 'stack' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', 'Enquiries — last 14 days'), h('a', { href: '#/enquiries' }, 'View all')), h('div', { class: 'card-body' }, chart)),
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', 'Latest enquiries'), h('a', { href: '#/enquiries' }, 'Open inbox')),
          h(
            'div',
            { class: 'card-body', style: 'padding-top:6px' },
            d.recent_enquiries.length
              ? h(
                  'div',
                  { class: 'list' },
                  d.recent_enquiries.map((e) =>
                    h(
                      'a',
                      { class: 'list-item', href: `#/enquiries?id=${e.id}` },
                      h('div', { class: 'avatar', style: 'background:var(--accent-soft);color:var(--accent-hover)' }, fmt.initials(e.student_name)),
                      h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'cell-title truncate' }, e.student_name, e.class_applying ? h('span', { class: 'muted', style: 'font-weight:400' }, ` · ${e.class_applying}`) : null), h('div', { class: 'cell-sub truncate' }, `${e.parent_name ? `${e.parent_name} · ` : ''}${e.phone}`)),
                      h('div', { style: 'text-align:right' }, statusBadge(e.status), h('div', { class: 'cell-sub' }, fmt.relative(e.created_at))),
                    ),
                  ),
                )
              : h('p', { class: 'muted', style: 'margin:8px 0 0' }, 'No enquiries yet. They will show up here as soon as the website form receives one.'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'stack' },
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', 'Quick actions')),
          h(
            'div',
            { class: 'card-body' },
            h(
              'div',
              { class: 'quick' },
              quick('#/posts?new=1', 'file', 'New post'),
              quick('#/gallery?new=1', 'image', 'Upload photos'),
              quick('#/videos?new=1', 'video', 'Add video'),
              quick('#/events?new=1', 'calendar', 'New event'),
              quick('#/notices?new=1', 'megaphone', 'New notice'),
              quick('#/enquiries?new=1', 'inbox', 'Add enquiry'),
            ),
          ),
        ),
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', 'Upcoming events'), h('a', { href: '#/events?when=upcoming' }, 'All events')),
          h(
            'div',
            { class: 'card-body', style: 'padding-top:6px' },
            d.upcoming_events.length
              ? h(
                  'div',
                  { class: 'list' },
                  d.upcoming_events.map((e) => {
                    const dt = new Date(e.start_at);
                    return h(
                      'a',
                      { class: 'list-item', href: '#/events?when=upcoming' },
                      h('div', { class: 'date-chip' }, h('span', dt.toLocaleDateString(undefined, { month: 'short' })), h('b', dt.getDate())),
                      h('div', { style: 'min-width:0' }, h('div', { class: 'cell-title truncate' }, e.title), h('div', { class: 'cell-sub truncate' }, [fmt.time(e.start_at), e.venue].filter(Boolean).join(' · '))),
                    );
                  }),
                )
              : h('p', { class: 'muted', style: 'margin:8px 0 0' }, 'No upcoming events. ', h('a', { href: '#/events?new=1' }, 'Add one')),
          ),
        ),
      ),
    ),
  );
}
