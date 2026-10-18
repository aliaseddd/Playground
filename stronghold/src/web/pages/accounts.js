// User Accounts: who can log in, with which roles (REQ_000_030, 033).
import { html, field, button, listView, fmt, openDialog, requiredLegend, attrs, ROLE_LABELS } from '../ui.js';

function rolesField(ctx) {
  const roles = ctx.state.add.roles;
  const invalid = ctx.invalid('Roles', 'roles');
  return html`<fieldset class="field roles${invalid ? ' is-invalid' : ''}">
    <legend>Roles<span class="req" aria-hidden="true">*</span><span class="sr"> (required)</span></legend>
    ${Object.entries(ROLE_LABELS).map(
      ([r, l]) => html`<label class="check"><input ${attrs({ type: 'checkbox', id: `role-${r}`, 'data-bind': `add.role_${r}`, checked: roles.includes(r) || ctx.state.add[`role_${r}`] })}><span>${l}</span></label>`,
    )}
    <p class="hint">Operators work the desk. Administrators keep the lists, accounts and settings. An account can hold both.</p>
  </fieldset>`;
}

function selectedRoles(add) {
  return Object.keys(ROLE_LABELS).filter((r) => add[`role_${r}`]);
}

export const accountsPage = {
  id: 'accounts',
  name: 'User Accounts',
  liveRefresh: true,
  title: () => 'User Accounts',
  lede: () => 'Accounts that can log in to Stronghold. Disable an account instead of deleting it, so the records it made still name who made them.',

  init: () => ({ add: { displayName: '', username: '', password: '', confirm: '', roles: [], role_operator: true, role_admin: false } }),

  view(ctx) {
    const a = ctx.state.add;
    const users = ctx.svc.listUsers(ctx.user.id);
    return html`
      <section class="panel">
        <h2>Add an account</h2>
        <form data-action="add" data-scope="add" novalidate autocomplete="off">
          ${ctx.errorFor('add')}
          ${requiredLegend()}
          <div class="grid-2">
            ${field({ id: 'uName', label: 'Name', bind: 'add.displayName', value: a.displayName, required: true, invalid: ctx.invalid('Name') })}
            ${field({ id: 'uUser', label: 'Username', bind: 'add.username', value: a.username, required: true, invalid: ctx.invalid('Username', 'username'), hint: '2 to 32 letters, digits, dots, dashes or underscores.', autocomplete: 'off' })}
            ${field({ id: 'uPass', label: 'Password', type: 'password', bind: 'add.password', value: a.password, required: true, invalid: ctx.invalid('Password', 'password'), hint: 'At least 8 characters. Give it to the person to use at their first log-in.', autocomplete: 'new-password' })}
            ${field({ id: 'uConfirm', label: 'Confirm password', type: 'password', bind: 'add.confirm', value: a.confirm, required: true, invalid: ctx.invalid('Confirm password', 'confirm'), autocomplete: 'new-password' })}
          </div>
          ${rolesField(ctx)}
          <div class="form-actions">${button({ label: 'Add Account', type: 'submit', kind: 'primary', iconName: 'plus' })}</div>
        </form>
      </section>
      ${listView(ctx, {
        id: 'accounts',
        noun: 'accounts',
        nounOne: 'account',
        items: users,
        rowId: (u) => u.id,
        searchText: (u) => `${u.displayName} ${u.username}`,
        searchPlaceholder: 'Name or username',
        empty: 'There are no accounts.',
        rowClass: (u) => (u.disabled ? 'is-muted' : ''),
        columns: [
          { label: 'Name', cell: (u) => html`<strong>${u.displayName}</strong>${u.id === ctx.user.id ? html` <span class="muted">(you)</span>` : ''}` },
          { label: 'Username', cell: (u) => html`<code>${u.username}</code>` },
          { label: 'Roles', cell: (u) => u.roles.map((r) => ROLE_LABELS[r]).join(', ') },
          { label: 'Status', cell: (u) => (u.disabled ? html`<span class="pill pill-muted">Disabled</span>` : html`<span class="pill pill-ok">Active</span>`) },
          { label: 'Last log-in', cls: 'num', cell: (u) => (u.lastLoginAt ? fmt.when(u.lastLoginAt) : 'Never') },
          {
            label: 'Actions',
            cls: 'col-actions',
            cell: (u) => html`<div class="row-actions">
              ${button({ label: 'Change', action: 'change', data: { id: u.id }, small: true })}
              ${button({ label: 'Set Password', action: 'password', data: { id: u.id }, small: true })}
              ${
                u.disabled
                  ? button({ label: 'Enable', action: 'enable', data: { id: u.id }, small: true })
                  : button({ label: 'Disable', action: 'disable', data: { id: u.id }, small: true, kind: 'danger-ghost', why: ctx.svc.whyCannotDisable(ctx.user.id, u.id) })
              }
            </div>`,
          },
        ],
      })}`;
  },

  actions: {
    async add(ctx) {
      const a = ctx.state.add;
      const u = await ctx.svc.addUser(ctx.user.id, { ...a, roles: selectedRoles(a) });
      ctx.state.add = { displayName: '', username: '', password: '', confirm: '', roles: [], role_operator: true, role_admin: false };
      ctx.say('ok', `Added the account ${u.username}.`);
      ctx.render();
    },

    async change(ctx, el) {
      const u = ctx.svc.listUsers(ctx.user.id).find((x) => x.id === el.dataset.id);
      if (!u) return;
      const done = await openDialog({
        title: `Change ${u.username}`,
        fields: [
          { name: 'displayName', label: 'Name', required: true, value: u.displayName },
          { name: 'roles', label: 'Roles', type: 'roles', required: true, value: u.roles },
        ],
        confirmLabel: 'Save Account',
        onConfirm: (v) => ctx.svc.changeUser(ctx.user.id, u.id, v),
      });
      if (done) ctx.say('ok', `Saved ${u.username}.`);
      ctx.render();
    },

    async password(ctx, el) {
      const u = ctx.svc.listUsers(ctx.user.id).find((x) => x.id === el.dataset.id);
      if (!u) return;
      const done = await openDialog({
        title: `Set a new password for ${u.username}`,
        intro: html`<p>The old password stops working at once. Tell the person their new password.</p>`,
        fields: [
          { name: 'password', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters.', autocomplete: 'new-password' },
          { name: 'confirm', label: 'Confirm new password', type: 'password', required: true, autocomplete: 'new-password' },
        ],
        confirmLabel: 'Set Password',
        onConfirm: (v) => ctx.svc.resetPassword(ctx.user.id, u.id, v),
      });
      if (done) ctx.say('ok', `New password set for ${u.username}.`);
      ctx.render();
    },

    async disable(ctx, el) {
      const u = ctx.svc.listUsers(ctx.user.id).find((x) => x.id === el.dataset.id);
      if (!u) return;
      const done = await openDialog({
        title: `Disable ${u.username}?`,
        intro: html`<p>${u.displayName} will not be able to log in, and is logged out at once. The records they made are kept. You can enable the account again later.</p>`,
        confirmLabel: 'Disable Account',
        danger: true,
        onConfirm: () => ctx.svc.setUserDisabled(ctx.user.id, u.id, true),
      });
      if (done) ctx.say('ok', `Disabled ${u.username}.`);
      ctx.render();
    },

    async enable(ctx, el) {
      await ctx.svc.setUserDisabled(ctx.user.id, el.dataset.id, false);
      ctx.say('ok', 'Account enabled.');
      ctx.render();
    },
  },
};
