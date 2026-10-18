// Watchlist: the names and dates of birth every sign-in is screened against (REQ_000_029).
import { html, field, button, listView, fmt, openDialog, requiredLegend, alertBox } from '../ui.js';
import { localIsoDate } from '../../core/text.js';

const RULES = html`<ul class="rules">
  <li><strong class="text-bad">Match</strong>: the name and the date of birth both match an entry. The sign-in is held.</li>
  <li><strong class="text-warn">Possible match</strong>: the name matches an entry but the date of birth does not. The sign-in is held.</li>
  <li><strong>No match</strong>: no entry has the name. The person is signed in.</li>
  <li><strong>Not run</strong>: watchlist screening is switched off in Settings. The sign-in is held.</li>
</ul>
<p class="hint">Names match when the first and last names are the same, ignoring capitals, accents, spaces and punctuation, and also when first and last name were entered the wrong way round. Matching never guesses at nicknames or spellings.</p>`;

export const watchlistPage = {
  id: 'watchlist',
  name: 'Watchlist',
  liveRefresh: true,
  title: () => 'Watchlist',
  lede: () => 'Every sign-in is checked against these entries before anyone is signed in. Only Administrators see this list; the desk sees an entry only when a sign-in matches it.',

  init: () => ({ entry: { firstName: '', lastName: '', dob: '' } }),

  view(ctx) {
    const e = ctx.state.entry;
    const items = ctx.svc.listWatchlist(ctx.user.id);
    const off = !ctx.svc.settings().watchlistAvailable;
    return html`
      ${off ? alertBox('warn', 'Watchlist screening is switched off', html`<p>Every sign-in is held as “Not run” until it is switched on again in <a href="#/settings">Settings</a>.</p>`) : ''}
      <div class="split">
        <section class="panel">
          <h2>Add an entry</h2>
          <form data-action="add" data-scope="add" novalidate>
            ${ctx.errorFor('add')}
            ${requiredLegend()}
            <div class="grid-3">
              ${field({ id: 'wFirst', label: 'First name', bind: 'entry.firstName', value: e.firstName, required: true, invalid: ctx.invalid('First name', 'firstName'), autocomplete: 'off' })}
              ${field({ id: 'wLast', label: 'Last name', bind: 'entry.lastName', value: e.lastName, required: true, invalid: ctx.invalid('Last name'), autocomplete: 'off' })}
              ${field({ id: 'wDob', label: 'Date of birth', type: 'date', bind: 'entry.dob', value: e.dob, required: true, invalid: ctx.invalid('Date of birth', 'dob'), extra: { max: localIsoDate(new Date()), min: '1900-01-01' } })}
            </div>
            <div class="form-actions">${button({ label: 'Add Entry', type: 'submit', kind: 'primary', iconName: 'plus' })}</div>
          </form>
        </section>
        <section class="panel panel-quiet">
          <h2>How screening decides</h2>
          ${RULES}
        </section>
      </div>
      ${listView(ctx, {
        id: 'watchlist',
        noun: 'watchlist entries',
        nounOne: 'watchlist entry',
        items,
        rowId: (w) => w.id,
        searchText: (w) => `${w.firstName} ${w.lastName}`,
        empty: 'The watchlist is empty, so every screening finds no match.',
        columns: [
          { label: 'Name', cell: (w) => html`<strong>${w.lastName}, ${w.firstName}</strong>` },
          { label: 'Date of birth', cls: 'num', cell: (w) => fmt.dob(w.dob) },
          { label: 'Added', cls: 'num', cell: (w) => fmt.date(w.createdAt) },
          { label: 'Changed', cls: 'num', cell: (w) => (w.updatedAt && w.updatedAt !== w.createdAt ? fmt.date(w.updatedAt) : '') },
          {
            label: 'Actions',
            cls: 'col-actions',
            cell: (w) => html`<div class="row-actions">
              ${button({ label: 'Change', action: 'change', data: { id: w.id }, small: true })}
              ${button({ label: 'Remove', action: 'remove', data: { id: w.id }, small: true, kind: 'danger-ghost' })}
            </div>`,
          },
        ],
      })}`;
  },

  actions: {
    async add(ctx) {
      const entry = await ctx.svc.addWatchlistEntry(ctx.user.id, ctx.state.entry);
      ctx.state.entry = { firstName: '', lastName: '', dob: '' };
      ctx.say('ok', `Added ${entry.firstName} ${entry.lastName} to the watchlist.`);
      ctx.focusAfter = '#wFirst';
      ctx.render();
    },

    async change(ctx, el) {
      const w = ctx.svc.listWatchlist(ctx.user.id).find((x) => x.id === el.dataset.id);
      if (!w) return;
      const done = await openDialog({
        title: 'Change Watchlist Entry',
        intro: html`<p>The change is kept in the Audit Log.</p>`,
        fields: [
          { name: 'firstName', label: 'First name', required: true, value: w.firstName },
          { name: 'lastName', label: 'Last name', required: true, value: w.lastName },
          { name: 'dob', label: 'Date of birth', type: 'date', required: true, value: w.dob },
        ],
        confirmLabel: 'Save Entry',
        onConfirm: (v) => ctx.svc.changeWatchlistEntry(ctx.user.id, w.id, v),
      });
      if (done) ctx.say('ok', 'Watchlist entry saved.');
      ctx.render();
    },

    async remove(ctx, el) {
      const w = ctx.svc.listWatchlist(ctx.user.id).find((x) => x.id === el.dataset.id);
      if (!w) return;
      const done = await openDialog({
        title: `Remove ${w.firstName} ${w.lastName} from the watchlist?`,
        intro: html`<p>Sign-ins will no longer be checked against this entry. The removal is kept in the Audit Log with your reason.</p>`,
        fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
        confirmLabel: 'Remove Entry',
        danger: true,
        onConfirm: (v) => ctx.svc.removeWatchlistEntry(ctx.user.id, w.id, v.reason),
      });
      if (done) ctx.say('ok', 'Watchlist entry removed.');
      ctx.render();
    },
  },
};
