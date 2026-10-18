// Person Record: one person's details and visit history (REQ_000_025), with sign-out, badge
// printing (REQ_000_022) and logged corrections (REQ_000_035).
import { html, listView, fmt, typeTag, screeningPill, button, openDialog, toLocalInput, TYPE_LABELS } from '../ui.js';
import { printBadge } from '../print.js';
import { localIsoDate } from '../../core/text.js';

function findVisit(ctx, id) {
  return ctx.svc.getPerson(ctx.user.id, ctx.params.id).visits.find((v) => v.id === id);
}

export const personPage = {
  id: 'person',
  name: 'Person Record',
  liveRefresh: true,
  title: () => 'Person Record',

  view(ctx) {
    let data;
    try {
      data = ctx.svc.getPerson(ctx.user.id, ctx.params.id);
    } catch (e) {
      return html`<p class="empty">${e.message}</p><p><a href="#/people">Back to People</a></p>`;
    }
    const { person, visits } = data;
    const open = person.openVisit;
    const isAdmin = ctx.user.roles.includes('admin');
    const signInWhy = person.status === 'in' ? 'Already signed in.' : person.status === 'held' ? 'A sign-in is waiting for a decision on Held Sign-Ins.' : null;
    const deleteWhy = !isAdmin ? 'Only Administrator accounts can delete records.' : ctx.svc.whyCannotDeletePerson(person.id);

    return html`
      <section class="record-head">
        <div>
          <p class="eyebrow">${typeTag(person.type)}</p>
          <h2 class="record-name">${person.firstName} ${person.lastName}</h2>
          <p class="record-status">${
            open
              ? html`<span class="pill pill-in">Signed in</span> since ${fmt.whenInline(open.signInAt)}, at ${open.destination}`
              : person.status === 'held'
                ? html`<span class="pill pill-warn">Sign-in held</span> <a href="#/held/${person.hold.id}">Open the held sign-in</a>`
                : html`<span class="muted">Not signed in</span>`
          }</p>
        </div>
        <div class="record-actions">
          ${
            open
              ? button({ label: 'Sign Out', action: 'sign-out', data: { visit: open.id }, kind: 'primary', iconName: 'out', id: 'rec-sign-out' })
              : button({ label: 'Sign In', action: 'go-sign-in', kind: 'primary', why: signInWhy, id: 'rec-sign-in' })
          }
          ${button({ label: 'Print Badge', action: 'print-badge', data: { visit: open ? open.id : '' }, iconName: 'print', why: ctx.svc.whyNoBadge(open), id: 'rec-print' })}
          ${button({ label: 'Edit Details', action: 'edit', id: 'rec-edit' })}
          ${button({ label: 'Delete Record', action: 'delete', kind: 'danger-ghost', why: deleteWhy, id: 'rec-delete' })}
        </div>
      </section>

      <dl class="facts facts-wide">
        <div><dt>Person type</dt><dd>${TYPE_LABELS[person.type]}</dd></div>
        <div><dt>Date of birth</dt><dd>${fmt.dob(person.dob)}</dd></div>
        ${person.type === 'contractor' ? html`<div><dt>Company</dt><dd>${person.company}</dd></div>` : ''}
        <div><dt>Visits</dt><dd>${person.visitCount}</dd></div>
        <div><dt>Record created</dt><dd>${fmt.date(person.createdAt)} by ${person.createdBy ? person.createdBy.name : 'unknown'}</dd></div>
      </dl>

      <h2>Visit history</h2>
      ${listView(ctx, {
        id: 'visits',
        noun: 'visits',
        nounOne: 'visit',
        items: visits,
        rowId: (v) => v.id,
        searchText: (v) => `${v.destination} ${fmt.date(v.signInAt)} ${v.signedInBy.name} ${v.screening}`,
        searchPlaceholder: 'Destination, date or name of the operator',
        empty: 'No visits are recorded for this person.',
        rowClass: (v) => (v.signOutAt ? '' : 'is-open'),
        columns: [
          { label: 'No.', cls: 'num', cell: (v) => fmt.visitNo(v.number) },
          { label: 'Signed in', cls: 'num', cell: (v) => fmt.dateTime(v.signInAt) },
          {
            label: 'Signed out',
            cls: 'num',
            cell: (v) => (v.signOutAt ? (localIsoDate(new Date(v.signOutAt)) === localIsoDate(new Date(v.signInAt)) ? fmt.time(v.signOutAt) : fmt.dateTime(v.signOutAt)) : html`<span class="pill pill-in">In the building</span>`),
          },
          { label: 'Stay', cls: 'num', cell: (v) => (v.signOutAt ? fmt.duration(v.signInAt, v.signOutAt) : '') },
          { label: 'Destination', cell: (v) => html`${v.destination}${v.destinationSource === 'typed' ? html` <span class="muted">(typed)</span>` : ''}` },
          {
            label: 'Recorded by',
            cell: (v) => html`<span class="by">In: ${v.signedInBy.name}</span>${v.signedOutBy ? html`<span class="by">Out: ${v.signedOutBy.name}</span>` : ''}`,
          },
          {
            label: 'Screening',
            cell: (v) =>
              html`${screeningPill(v.screening)}${v.decisionId ? html`<span class="by">Admitted after a decision</span>` : ''}${v.corrections ? html`<span class="by">Corrected ${v.corrections === 1 ? 'once' : `${v.corrections} times`}</span>` : ''}`,
          },
          { label: 'Actions', cls: 'col-actions', cell: (v) => button({ label: 'Correct', action: 'correct', data: { visit: v.id }, small: true }) },
        ],
      })}
      <p class="hint">Correct changes a recorded sign-in or sign-out time or the destination. Every correction needs a reason and is kept in the Audit Log.</p>
      <p><a href="#/people">Back to People</a></p>`;
  },

  actions: {
    'go-sign-in'(ctx) {
      ctx.app.go(`sign-in/${ctx.params.id}`);
    },

    async 'sign-out'(ctx, el) {
      const { signedOut } = await ctx.svc.signOut(ctx.user.id, [el.dataset.visit]);
      if (signedOut.length) ctx.say('ok', `Signed out at ${fmt.time(signedOut[0].visit.signOutAt)}.`);
      ctx.render();
    },

    async 'print-badge'(ctx, el) {
      const r = await printBadge(ctx.svc, ctx.user.id, el.dataset.visit);
      ctx.say(r.ok ? 'ok' : 'warn', r.text);
      ctx.render();
    },

    async edit(ctx) {
      const { person } = ctx.svc.getPerson(ctx.user.id, ctx.params.id);
      const done = await openDialog({
        title: 'Edit Details',
        intro: html`<p>Changes to a person's details are kept in the Audit Log with the reason.</p>`,
        fields: [
          { name: 'type', label: 'Person type', type: 'select', required: true, value: person.type, placeholder: null, redraw: true, options: [{ value: 'visitor', label: 'Visitor' }, { value: 'contractor', label: 'Contractor' }] },
          { name: 'firstName', label: 'First name', required: true, value: person.firstName },
          { name: 'lastName', label: 'Last name', required: true, value: person.lastName },
          { name: 'dob', label: 'Date of birth', type: 'date', required: true, value: person.dob },
          { name: 'company', label: 'Company', required: true, value: person.company || '', showIf: (v) => v.type === 'contractor' },
          { name: 'reason', label: 'Reason for the change', type: 'textarea', required: true },
        ],
        confirmLabel: 'Save Changes',
        onConfirm: (v) => ctx.svc.updatePerson(ctx.user.id, person.id, v, v.reason),
      });
      if (done) ctx.say('ok', 'Details saved.');
      ctx.render();
    },

    async delete(ctx) {
      const { person } = ctx.svc.getPerson(ctx.user.id, ctx.params.id);
      const done = await openDialog({
        title: `Delete the record of ${person.firstName} ${person.lastName}?`,
        intro: html`<p>The record is deleted for good. The Audit Log keeps who deleted it, when and why, under the record's identifier. It keeps no personal details, except in decisions on held sign-ins, which must keep the name and date of birth.</p>`,
        fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
        confirmLabel: 'Delete Record',
        danger: true,
        onConfirm: (v) => ctx.svc.deletePerson(ctx.user.id, person.id, v.reason),
      });
      if (done) ctx.app.go('people', { flash: { kind: 'ok', title: 'The record was deleted.' } });
    },

    async correct(ctx, el) {
      const v = findVisit(ctx, el.dataset.visit);
      if (!v) return;
      const done = await openDialog({
        title: `Correct visit ${fmt.visitNo(v.number)}`,
        intro: v.signOutAt
          ? html`<p>Change what was recorded. A recorded sign-out can be moved but not removed.</p>`
          : html`<p>This person is still signed in. Fill in Signed out only to record a sign-out that was missed; otherwise use Sign Out.</p>`,
        fields: [
          { name: 'signInAt', label: 'Signed in', type: 'datetime-local', required: true, value: toLocalInput(v.signInAt) },
          { name: 'signOutAt', label: 'Signed out', type: 'datetime-local', required: Boolean(v.signOutAt), value: toLocalInput(v.signOutAt) },
          { name: 'destination', label: 'Destination', required: true, value: v.destination },
          { name: 'reason', label: 'Reason for the change', type: 'textarea', required: true, hint: 'For example: left at 3:45 PM without signing out.' },
        ],
        confirmLabel: 'Save Correction',
        // The form shows minutes only, so an unchanged time keeps its recorded seconds.
        onConfirm: (val) =>
          ctx.svc.correctVisit(
            ctx.user.id,
            v.id,
            {
              signInAt: val.signInAt === toLocalInput(v.signInAt) ? v.signInAt : val.signInAt,
              signOutAt: !val.signOutAt ? null : val.signOutAt === toLocalInput(v.signOutAt) ? v.signOutAt : val.signOutAt,
              destination: val.destination,
            },
            val.reason,
          ),
      });
      if (done) ctx.say('ok', `Visit ${fmt.visitNo(v.number)} corrected. The change is in the Audit Log.`);
      ctx.render();
    },
  },
};

