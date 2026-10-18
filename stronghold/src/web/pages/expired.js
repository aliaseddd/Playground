// Expired Visits: visits past the retention period, which an Administrator may delete
// (REQ_000_038). This is the only way a visit leaves the history (REQ_000_039).
import { html, listView, fmt, button, personLink, openDialog } from '../ui.js';

export const expiredPage = {
  id: 'expired',
  name: 'Expired Visits',
  liveRefresh: true,
  title: () => 'Expired Visits',
  lede: (ctx) => {
    const s = ctx.svc.settings();
    return `Visits signed out more than ${fmt.count(s.retentionDays, 'day')} ago, before ${fmt.date(ctx.svc.retentionCutoff().toISOString())}. The retention period is set in Settings. Visits are never deleted automatically.`;
  },

  view(ctx) {
    const rows = ctx.svc.expiredVisits(ctx.user.id);
    return listView(ctx, {
      id: 'expired',
      noun: 'expired visits',
      nounOne: 'expired visit',
      items: rows,
      rowId: (r) => r.visit.id,
      selectable: true,
      selectLabel: (r) => `visit ${fmt.visitNo(r.visit.number)}`,
      searchText: (r) => `${r.person ? `${r.person.firstName} ${r.person.lastName}` : ''} ${r.visit.destination}`,
      empty: 'No visits have passed the retention period.',
      toolbar: (selected) =>
        button({
          label: selected.length ? `Delete Selected (${selected.length})` : 'Delete Selected',
          action: 'delete-selected',
          kind: 'danger',
          id: 'delete-selected',
          why: selected.length ? null : 'Tick the visits to delete first. The box in the heading ticks every visit on the page.',
        }),
      columns: [
        { label: 'No.', cls: 'num', cell: (r) => fmt.visitNo(r.visit.number) },
        { label: 'Name', cell: (r) => (r.person ? personLink(r.person) : 'Record deleted') },
        { label: 'Signed in', cls: 'num', cell: (r) => fmt.dateTime(r.visit.signInAt) },
        { label: 'Signed out', cls: 'num', cell: (r) => fmt.dateTime(r.visit.signOutAt) },
        { label: 'Destination', cell: (r) => r.visit.destination },
      ],
    });
  },

  actions: {
    async 'delete-selected'(ctx) {
      const st = ctx.list('expired');
      const ids = [...st.selected];
      if (!ids.length) return;
      const result = await openDialog({
        title: `Delete ${fmt.count(ids.length, 'visit')} for good?`,
        intro: html`<p>Deleted visits cannot be brought back. The Audit Log keeps the number of each deleted visit, who deleted it, when and why. It keeps no personal details, except in decisions on held sign-ins, which must keep the name and date of birth.</p>`,
        fields: [
          { name: 'reason', label: 'Reason', type: 'textarea', required: true, value: 'Retention period has passed.' },
          { name: 'orphans', label: 'Also delete the person records left with no visits', type: 'checkbox', value: true, hint: 'A person who has no other visits and no held sign-in is deleted too, so their name and date of birth are not kept.' },
        ],
        confirmLabel: `Delete ${fmt.count(ids.length, 'Visit')}`,
        danger: true,
        onConfirm: (v) => ctx.svc.deleteExpiredVisits(ctx.user.id, ids, v.reason, { deleteOrphans: v.orphans }),
      });
      if (!result) return;
      st.selected.clear();
      ctx.say('ok', `Deleted ${fmt.count(result.visits, 'visit')}${result.people ? ` and ${fmt.count(result.people, 'person record')}` : ''}.`);
      ctx.render();
    },
  },
};
