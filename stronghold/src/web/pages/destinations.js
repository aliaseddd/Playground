// Destinations: the list the desk chooses from at sign-in (REQ_000_028).
import { html, field, button, listView, fmt, openDialog, requiredLegend } from '../ui.js';

export const destinationsPage = {
  id: 'destinations',
  name: 'Destinations',
  liveRefresh: true,
  title: () => 'Destinations',
  lede: () => 'The places a person can be signed in to. Renaming or removing one does not change past visits, which keep the name they were recorded with.',

  init: () => ({ name: '' }),

  view(ctx) {
    const items = ctx.svc.listDestinations(ctx.user.id);
    return html`
      <section class="panel">
        <h2>Add a destination</h2>
        <form class="inline-form" data-action="add" data-scope="add" novalidate>
          ${ctx.errorFor('add')}
          ${requiredLegend()}
          <div class="inline-row">
            ${field({ id: 'destName', label: 'Name', bind: 'name', value: ctx.state.name, required: true, invalid: ctx.invalid('Name', 'name'), autocomplete: 'off', placeholder: 'For example: Finance, 2nd Floor' })}
            ${button({ label: 'Add Destination', type: 'submit', kind: 'primary', iconName: 'plus' })}
          </div>
        </form>
      </section>
      ${listView(ctx, {
        id: 'destinations',
        noun: 'destinations',
        nounOne: 'destination',
        items,
        rowId: (d) => d.id,
        searchText: (d) => d.name,
        searchPlaceholder: 'Destination name',
        empty: 'The destination list is empty. Add the first destination above; until then the desk types a destination for each visit.',
        columns: [
          { label: 'Name', cell: (d) => html`<strong>${d.name}</strong>` },
          { label: 'Added', cls: 'num', cell: (d) => fmt.date(d.createdAt) },
          {
            label: 'Actions',
            cls: 'col-actions',
            cell: (d) => html`<div class="row-actions">
              ${button({ label: 'Rename', action: 'rename', data: { id: d.id }, small: true })}
              ${button({ label: 'Remove', action: 'remove', data: { id: d.id }, small: true, kind: 'danger-ghost' })}
            </div>`,
          },
        ],
      })}`;
  },

  actions: {
    async add(ctx) {
      const d = await ctx.svc.addDestination(ctx.user.id, ctx.state.name);
      ctx.state.name = '';
      ctx.say('ok', `Added ${d.name}.`);
      ctx.focusAfter = '#destName';
      ctx.render();
    },

    async rename(ctx, el) {
      const d = ctx.svc.listDestinations(ctx.user.id).find((x) => x.id === el.dataset.id);
      if (!d) return;
      const done = await openDialog({
        title: `Rename ${d.name}`,
        fields: [{ name: 'name', label: 'Name', required: true, value: d.name }],
        confirmLabel: 'Save Name',
        onConfirm: (v) => ctx.svc.renameDestination(ctx.user.id, d.id, v.name),
      });
      if (done) ctx.say('ok', 'Destination renamed.');
      ctx.render();
    },

    async remove(ctx, el) {
      const d = ctx.svc.listDestinations(ctx.user.id).find((x) => x.id === el.dataset.id);
      if (!d) return;
      const done = await openDialog({
        title: `Remove ${d.name}?`,
        intro: html`<p>The desk will no longer be able to choose it. Past visits keep it. The removal is kept in the Audit Log with your reason.</p>`,
        fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
        confirmLabel: 'Remove Destination',
        danger: true,
        onConfirm: (v) => ctx.svc.removeDestination(ctx.user.id, d.id, v.reason),
      });
      if (done) ctx.say('ok', `Removed ${d.name}.`);
      ctx.render();
    },
  },
};
