// Backup: download every record, restore into an empty installation, and remove the example
// records. Records live only in this browser, so a backup is the way to keep them safe.
import { html, button, openDialog, fmt } from '../ui.js';
import { saveFile, inClaudeViewer, FILE_MODE_NOTE } from '../env.js';
import { localIsoDate } from '../../core/text.js';
import { UserError } from '../../core/service.js';

export const backupPage = {
  id: 'backup',
  name: 'Backup',
  title: () => 'Backup',
  lede: () => 'Stronghold keeps its records only in this browser. A backup file is how they survive a new computer, a reinstalled browser or cleared site data.',

  view(ctx) {
    const store = ctx.svc.describeStore();
    const restoreWhy = ctx.svc.whyCannotRestore();
    return html`
      <div class="split">
        <section class="panel">
          <h2>Download a backup</h2>
          <p>One file with every person, visit, list, account and Audit Log entry. Passwords are stored only as hashes.</p>
          <p class="hint">The file holds personal details. Keep it where only Administrators can open it.</p>
          <div class="form-actions">${button({ label: 'Download Backup', action: 'download', kind: 'primary', iconName: 'file', id: 'download-backup' })}</div>
        </section>
        <section class="panel">
          <h2>Restore a backup</h2>
          <p>Restoring replaces every record with the contents of a backup file.</p>
          <form data-action="restore" data-scope="restore" novalidate>
            ${ctx.errorFor('restore')}
            <div class="field">
              <label for="restoreFile">Backup file<span class="req" aria-hidden="true">*</span><span class="sr"> (required)</span></label>
              <input id="restoreFile" type="file" accept=".json,application/json" aria-required="true" ${restoreWhy ? 'disabled' : ''}>
            </div>
            <div class="form-actions">${button({ label: 'Restore Backup', type: 'submit', id: 'restore-backup', why: restoreWhy })}</div>
          </form>
        </section>
      </div>
      <section class="panel panel-quiet">
        <h2>Where records are kept</h2>
        <dl class="facts facts-wide">
          <div><dt>Storage</dt><dd>${store.label}${inClaudeViewer ? ', inside the Claude viewer' : ''}</dd></div>
          <div><dt>Protected from clean-up</dt><dd>${store.kind === 'memory' ? 'No. Records are lost when the page closes.' : store.persisted ? 'Yes. The browser has agreed not to clear these records to save space.' : 'Not confirmed. The browser may clear site data when it runs low on space, so download backups regularly.'}</dd></div>
        </dl>
        ${ctx.app.fileMode ? html`<p class="hint"><strong>Opened as a file.</strong> ${FILE_MODE_NOTE}</p>` : ''}
        <p class="hint">Nothing is sent to a server. Clearing this site's data in the browser settings erases every record here.</p>
      </section>
      ${
        ctx.svc.hasSampleData()
          ? html`<section class="panel panel-attention">
              <h2>Example records</h2>
              <p>The example people, visits, destinations and watchlist entries added at setup are still here. Remove them before real use. Visits, people and other records that real accounts made are kept.</p>
              <div class="form-actions">${button({ label: 'Remove Example Records', action: 'remove-examples', kind: 'danger', id: 'remove-examples' })}</div>
            </section>`
          : ''
      }`;
  },

  actions: {
    async download(ctx) {
      const backup = await ctx.svc.exportBackup(ctx.user.id);
      const name = `stronghold-backup-${localIsoDate(new Date())}.json`;
      const result = await saveFile(name, JSON.stringify(backup, null, 1), 'application/json');
      ctx.say(result === 'saved' ? 'ok' : 'info', result === 'saved' ? `Saved ${name}.` : 'The backup was not saved.');
      ctx.render();
    },

    async restore(ctx, form) {
      const file = form.querySelector('#restoreFile').files[0];
      if (!file) throw new UserError('Fill in the required detail: Backup file.', { missing: ['Backup file'] });
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new UserError('This file is not a Stronghold backup.', { field: 'file' });
      }
      const done = await openDialog({
        title: 'Replace every record with this backup?',
        intro: html`<p>The backup was made ${data.exportedAt ? fmt.dateTime(data.exportedAt) : 'at an unknown time'}. Every account, list and setting here is replaced by the backup's. You will need to log in again.</p>`,
        confirmLabel: 'Restore Backup',
        danger: true,
        onConfirm: () => ctx.svc.restoreBackup(ctx.user.id, data),
      });
      if (done) ctx.app.logOut('Backup restored. Log in with an account from the backup.');
    },

    async 'remove-examples'(ctx) {
      const result = await openDialog({
        title: 'Remove the example records?',
        intro: html`<p>Every example visit, example person with no real visits, and example destination and watchlist entry is deleted for good. The Audit Log keeps a list of what was removed.</p>`,
        fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, value: 'Starting real use.' }],
        confirmLabel: 'Remove Example Records',
        danger: true,
        onConfirm: (v) => ctx.svc.removeExampleRecords(ctx.user.id, v.reason),
      });
      if (result) ctx.say('ok', `Removed ${fmt.count(result.removed, 'example record')}.`, result.keptPeople ? `${fmt.count(result.keptPeople, 'example person was', 'example people were')} kept because real visits name them.` : '');
      ctx.render();
    },
  },
};

