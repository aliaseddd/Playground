// Currently Signed In: exactly the people with an open visit (REQ_000_011), each with Sign Out
// (REQ_000_006) and Print Badge (REQ_000_022).
import { html, listView, fmt, typeTag, button, personLink, openDialog } from '../ui.js';
import { printBadge } from '../print.js';
import { localIsoDate } from '../../core/text.js';

export const presentPage = {
  id: 'present',
  name: 'Currently Signed In',
  liveRefresh: true,
  title: () => 'Currently Signed In',
  lede: () => 'Everyone in the building now. Sign people out here as they leave.',

  view(ctx) {
    const rows = ctx.svc.presentList(ctx.user.id);
    const today = localIsoDate(new Date());
    return listView(ctx, {
      id: 'present',
      noun: 'people signed in',
      nounOne: 'person signed in',
      caption: 'People signed in now',
      items: rows,
      rowId: (r) => r.visit.id,
      selectable: true,
      selectLabel: (r) => `${r.person.firstName} ${r.person.lastName}`,
      rowClass: (r) => (localIsoDate(new Date(r.visit.signInAt)) < today ? 'is-stale' : ''),
      searchText: (r) => `${r.person.firstName} ${r.person.lastName} ${r.person.company || ''} ${r.visit.destination}`,
      empty: 'Nobody is signed in right now.',
      toolbar: (selected) =>
        button({
          label: selected.length ? `Sign Out Selected (${selected.length})` : 'Sign Out Selected',
          action: 'sign-out-selected',
          iconName: 'out',
          id: 'sign-out-selected',
          why: selected.length ? null : 'Tick the people to sign out first.',
        }),
      columns: [
        { label: 'Name', cell: (r) => personLink(r.person) },
        { label: 'Type', cell: (r) => typeTag(r.person.type) },
        { label: 'Company', cell: (r) => r.person.company || '' },
        { label: 'Destination', cell: (r) => r.visit.destination },
        {
          label: 'Signed in',
          cls: 'num',
          cell: (r) => html`${fmt.when(r.visit.signInAt)}${localIsoDate(new Date(r.visit.signInAt)) < today ? html`<span class="stale-note">Not signed out on the day</span>` : ''}`,
        },
        { label: 'Signed in by', cell: (r) => r.visit.signedInBy.name },
        {
          label: 'Actions',
          cls: 'col-actions',
          cell: (r) => html`<div class="row-actions">
            ${button({ label: 'Sign Out', action: 'sign-out', data: { visit: r.visit.id }, kind: 'primary', small: true, iconName: 'out' })}
            ${button({ label: 'Print Badge', action: 'print-badge', data: { visit: r.visit.id }, small: true, iconName: 'print' })}
          </div>`,
        },
      ],
    });
  },

  actions: {
    async 'sign-out'(ctx, el) {
      const { signedOut, skipped } = await ctx.svc.signOut(ctx.user.id, [el.dataset.visit]);
      if (signedOut.length) {
        const { person, visit } = signedOut[0];
        ctx.say('ok', `${person.firstName} ${person.lastName} signed out at ${fmt.time(visit.signOutAt)}.`);
      } else if (skipped.length) {
        ctx.say('info', `${skipped[0].person.firstName} ${skipped[0].person.lastName} was already signed out.`);
      }
      ctx.render();
    },

    // Several people at once: a bulk change, so it asks first (REQ_000_051).
    async 'sign-out-selected'(ctx) {
      const st = ctx.list('present');
      const rows = ctx.svc.presentList(ctx.user.id).filter((r) => st.selected.has(r.visit.id));
      if (!rows.length) return;
      const result = await openDialog({
        title: `Sign out ${fmt.count(rows.length, 'person', 'people')}?`,
        intro: html`<p>Each of these people will be signed out now, at the current time:</p><ul class="name-list">${rows.map((r) => html`<li>${r.person.firstName} ${r.person.lastName} <span class="muted">· ${r.visit.destination}</span></li>`)}</ul>`,
        confirmLabel: `Sign Out ${fmt.count(rows.length, 'Person', 'People')}`,
        onConfirm: () => ctx.svc.signOut(ctx.user.id, rows.map((r) => r.visit.id)),
      });
      if (!result) return;
      st.selected.clear();
      ctx.say('ok', `Signed out ${fmt.count(result.signedOut.length, 'person', 'people')}.`, result.skipped.length ? `${fmt.count(result.skipped.length, 'person was', 'people were')} already signed out.` : '');
      ctx.render();
    },

    async 'print-badge'(ctx, el) {
      const r = await printBadge(ctx.svc, ctx.user.id, el.dataset.visit);
      ctx.say(r.ok ? 'ok' : 'warn', r.text);
      ctx.render();
    },
  },
};
