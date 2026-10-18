import { html, field, checkboxField, button, requiredLegend } from '../ui.js';
import { inClaudeViewer } from '../env.js';
import { UserError } from '../../core/service.js';

export const setupPage = {
  id: 'setup',
  name: 'Set Up Stronghold',
  title: () => 'Set Up Stronghold',
  lede: () => 'Create the first account. It can work the desk and run the administration pages, and it can add more accounts later.',

  init: () => ({ sampleData: true, f: {} }),

  view(ctx) {
    const s = ctx.state;
    return html`
      <div class="setup-grid">
        <section class="panel">
          <h2>First account</h2>
          <form data-action="setup" novalidate autocomplete="on">
            ${ctx.errorFor('setup')}
            ${requiredLegend()}
            ${field({ id: 'siteName', bind: 'f.siteName', value: s.f.siteName, label: 'Building name', required: true, invalid: ctx.invalid('Building name'), hint: 'Shown in the menu and printed on every badge, for example Riverside Civic Center.', autocomplete: 'organization' })}
            ${field({ id: 'displayName', bind: 'f.displayName', value: s.f.displayName, label: 'Your name', required: true, invalid: ctx.invalid('Your name'), autocomplete: 'name' })}
            ${field({ id: 'username', bind: 'f.username', value: s.f.username, label: 'Username', required: true, invalid: ctx.invalid('Username', 'username'), hint: '2 to 32 letters, digits, dots, dashes or underscores.', autocomplete: 'username' })}
            ${field({ id: 'password', bind: 'f.password', value: s.f.password, label: 'Password', type: 'password', required: true, invalid: ctx.invalid('Password', 'password'), hint: 'At least 8 characters.', autocomplete: 'new-password' })}
            ${field({ id: 'confirm', bind: 'f.confirm', value: s.f.confirm, label: 'Confirm password', type: 'password', required: true, invalid: ctx.invalid('Confirm password', 'confirm'), autocomplete: 'new-password' })}
            ${checkboxField({ id: 'sampleData', label: 'Add example records so Stronghold can be tried straight away', bind: 'sampleData', checked: s.sampleData, hint: '6 destinations, 4 watchlist entries, 13 invented people and three weeks of visits. An Administrator can remove them in one step on the Backup page.' })}
            <div class="form-actions">${button({ label: 'Create Account and Open Stronghold', kind: 'primary', type: 'submit' })}</div>
          </form>
        </section>
        <aside class="panel panel-quiet">
          <h2>Restore from a backup</h2>
          <p>A backup file from the Backup page brings back every account and record, for example on a new computer.</p>
          <form data-action="restore" novalidate>
            ${ctx.errorFor('restore')}
            <div class="field${ctx.invalid('Backup file', 'file') ? ' is-invalid' : ''}">
              <label for="backupFile">Backup file<span class="req" aria-hidden="true">*</span><span class="sr"> (required)</span></label>
              <input id="backupFile" name="backupFile" type="file" accept=".json,application/json" aria-required="true">
            </div>
            <div class="form-actions">${button({ label: 'Restore Backup', type: 'submit' })}</div>
          </form>
          <h2>Where records are kept</h2>
          <p>${
            inClaudeViewer
              ? 'In this browser, inside the Claude viewer. Nothing is sent to a server. Another browser or computer starts empty unless you restore a backup there.'
              : 'In this browser on this computer. Nothing is sent to a server. Another browser or computer starts empty unless you restore a backup there.'
          }</p>
        </aside>
      </div>`;
  },

  actions: {
    async setup(ctx, form, event, values) {
      const user = await ctx.svc.setUp({
        siteName: values.siteName,
        displayName: values.displayName,
        username: values.username,
        password: values.password,
        confirm: values.confirm,
        sampleData: Boolean(values.sampleData),
      });
      ctx.app.flash = { kind: 'ok', title: `Welcome, ${user.displayName}. Stronghold is ready.`, body: ctx.state.sampleData ? 'The example records are in place. The suggestions below show what to try.' : '' };
      ctx.app.logIn(user);
    },

    async restore(ctx, form) {
      const file = form.querySelector('#backupFile').files[0];
      if (!file) throw new UserError('Fill in the required detail: Backup file.', { missing: ['Backup file'] });
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new UserError('This file is not a Stronghold backup.', { field: 'file' });
      }
      await ctx.svc.restoreBackup(null, data);
      ctx.app.flash = { kind: 'ok', title: 'Backup restored. Log in with an account from the backup.' };
      ctx.app.go('');
    },
  },
};
