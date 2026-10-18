// People: every person ever signed in, listed straight away (REQ_000_045), each opening their
// record and visit history (REQ_000_025).
import { html, listView, fmt, typeTag, personLink, choiceField } from '../ui.js';

export const peoplePage = {
  id: 'people',
  name: 'People',
  liveRefresh: true,
  title: () => 'People',
  lede: () => 'Everyone who has been signed in. Open a name for the record and visit history.',

  init: () => ({ type: '' }),

  view(ctx) {
    const s = ctx.state;
    const people = ctx.svc.listPeople(ctx.user.id, { type: s.type || null });
    return html`
      ${choiceField({
        name: 'peopleType',
        legend: 'Show',
        bind: 'type',
        value: s.type,
        options: [
          { value: '', label: 'Everyone' },
          { value: 'visitor', label: 'Visitors', tone: 'visitor' },
          { value: 'contractor', label: 'Contractors', tone: 'contractor' },
        ],
      })}
      ${listView(ctx, {
        id: 'people',
        noun: 'people',
        nounOne: 'person',
        items: people,
        rowId: (p) => p.id,
        searchText: (p) => `${p.firstName} ${p.lastName} ${p.company || ''}`,
        searchPlaceholder: 'Name or company',
        empty: s.type ? `No ${s.type === 'visitor' ? 'visitors' : 'contractors'} have been signed in yet.` : 'Nobody has been signed in yet. People appear here after their first sign-in.',
        columns: [
          { label: 'Name', cell: (p) => personLink(p) },
          { label: 'Type', cell: (p) => typeTag(p.type) },
          { label: 'Date of birth', cls: 'num', cell: (p) => fmt.dob(p.dob) },
          { label: 'Company', cell: (p) => p.company || '' },
          { label: 'Visits', cls: 'num', cell: (p) => p.visitCount },
          { label: 'Last visit', cls: 'num', cell: (p) => (p.lastVisitAt ? fmt.date(p.lastVisitAt) : 'None') },
          {
            label: 'Status',
            cell: (p) =>
              p.status === 'in' ? html`<span class="pill pill-in">Signed in</span>` : p.status === 'held' ? html`<span class="pill pill-warn">Sign-in held</span>` : html`<span class="muted">Not signed in</span>`,
          },
        ],
      })}`;
  },

  actions: {},
};
