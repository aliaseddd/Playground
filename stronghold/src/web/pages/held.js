// Held Sign-Ins: every sign-in waiting for a decision. Open to every logged-in user, because
// any user may decide (REQ_000_020).
import { html, listView, fmt, screeningPill, typeTag } from '../ui.js';
import { holdPanel, admittedPanel, refusedPanel, decideFromForm, showAdmitted } from './outcome.js';
import { printBadge } from '../print.js';

export const heldPage = {
  id: 'held',
  name: 'Held Sign-Ins',
  liveRefresh: true,
  title: () => 'Held Sign-Ins',
  lede: () => 'Sign-ins stopped by screening. Nobody on this list is signed in until someone admits them.',

  init: () => ({ reasons: {}, outcome: null }),

  view(ctx) {
    const s = ctx.state;
    const backLink = html`<p><a href="#/held">Back to all held sign-ins</a></p>`;
    if (s.outcome) {
      return html`${s.outcome.kind === 'refused' ? refusedPanel(s.outcome) : admittedPanel(ctx, s.outcome)}${backLink}`;
    }
    if (ctx.params.id) {
      let hold;
      try {
        hold = ctx.svc.getHold(ctx.user.id, ctx.params.id);
      } catch (e) {
        return html`<p class="empty">${e.message}</p>${backLink}`;
      }
      return html`${holdPanel(ctx, hold)}${backLink}`;
    }
    const holds = ctx.svc.listHolds(ctx.user.id);
    return listView(ctx, {
      id: 'holds',
      noun: 'held sign-ins',
      nounOne: 'held sign-in',
      items: holds,
      rowId: (h) => h.id,
      searchText: (h) => `${h.person.firstName} ${h.person.lastName} ${h.destination}`,
      empty: 'No sign-ins are held. Every recent sign-in was either admitted or refused.',
      columns: [
        { label: 'Name', cell: (h) => html`<a class="name-link" href="#/held/${h.id}">${h.person.lastName}, ${h.person.firstName}</a>` },
        { label: 'Type', cell: (h) => typeTag(h.person.type) },
        { label: 'Date of birth', cls: 'num', cell: (h) => fmt.dob(h.person.dob) },
        { label: 'Screening', cell: (h) => screeningPill(h.screening) },
        { label: 'Destination', cell: (h) => h.destination },
        { label: 'Held', cls: 'num', cell: (h) => fmt.when(h.createdAt) },
        { label: 'Held by', cell: (h) => h.createdBy.name },
        { label: 'Record', cell: (h) => (h.personId ? html`<a href="#/people/${h.personId}">Open record</a>` : html`<span class="muted">New entry</span>`) },
      ],
    });
  },

  actions: {
    async decide(ctx, form, event) {
      const result = await decideFromForm(ctx, form, event);
      if (result.decision === 'refuse') {
        ctx.state.outcome = { kind: 'refused', name: `${result.hold.person.firstName} ${result.hold.person.lastName}`, screening: result.hold.screening };
        ctx.render();
        return;
      }
      await showAdmitted(ctx, result, (o) => (ctx.state.outcome = o));
    },

    async 'print-badge'(ctx, el) {
      const r = await printBadge(ctx.svc, ctx.user.id, el.dataset.visit);
      if (ctx.state.outcome) ctx.state.outcome.printResult = r;
      ctx.render();
    },
  },
};

