// Settings: building name, retention period (REQ_000_031) and watchlist screening.
import { html, field, checkboxField, button, requiredLegend } from '../ui.js';
import { MAX_RETENTION_DAYS } from '../../core/service.js';

function current(ctx) {
  const s = ctx.svc.settings();
  return { siteName: s.siteName, retentionDays: String(s.retentionDays), watchlistAvailable: s.watchlistAvailable };
}

export const settingsPage = {
  id: 'settings',
  name: 'Settings',
  title: () => 'Settings',
  lede: () => 'Settings for the whole installation. Every change is kept in the Audit Log.',

  init: (ctx) => ({ f: current(ctx), orig: current(ctx) }),

  view(ctx) {
    const f = ctx.state.f;
    return html`<section class="panel">
      <form data-action="save" data-scope="save" novalidate>
        ${ctx.errorFor('save')}
        ${requiredLegend()}
        ${field({ id: 'siteName', label: 'Building name', bind: 'f.siteName', value: f.siteName, required: true, invalid: ctx.invalid('Building name'), hint: 'Shown in the menu and printed on every badge.' })}
        ${field({
          id: 'retentionDays',
          label: 'Retention period, in days',
          type: 'number',
          bind: 'f.retentionDays',
          value: f.retentionDays,
          required: true,
          invalid: ctx.invalid('Retention period', 'retentionDays'),
          extra: { min: 1, max: MAX_RETENTION_DAYS, step: 1, inputmode: 'numeric' },
          hint: `How long a visit is kept after the person signs out, from 1 to ${MAX_RETENTION_DAYS} days. When it has passed, the visit appears on Expired Visits, where an Administrator can delete it. Nothing is deleted automatically.`,
        })}
        ${checkboxField({
          id: 'watchlistAvailable',
          label: 'Screen every sign-in against the watchlist',
          bind: 'f.watchlistAvailable',
          checked: f.watchlistAvailable,
          hint: 'Switch this off only while the watchlist is being rebuilt. While it is off, screening does not run and every sign-in is held as “Not run” until someone admits or refuses the person.',
        })}
        <div class="form-actions">${button({ label: 'Save Settings', type: 'submit', kind: 'primary' })}</div>
      </form>
    </section>`;
  },

  actions: {
    // Saves only what was changed on this page, so an older copy of the page open elsewhere
    // cannot undo another Administrator's change to a different setting.
    async save(ctx) {
      const { f, orig } = ctx.state;
      const changed = Object.fromEntries(Object.keys(f).filter((k) => f[k] !== orig[k]).map((k) => [k, f[k]]));
      await ctx.svc.updateSettings(ctx.user.id, { ...current(ctx), ...changed });
      ctx.state.f = current(ctx);
      ctx.state.orig = current(ctx);
      ctx.say('ok', 'Settings saved.');
      ctx.render();
    },
  },
};
