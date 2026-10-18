// My Account: who is logged in, and changing one's own password.
import { html, field, button, requiredLegend, fmt, ROLE_LABELS } from '../ui.js';

export const myAccountPage = {
  id: 'my-account',
  name: 'My Account',
  title: () => 'My Account',

  init: () => ({ f: { current: '', password: '', confirm: '' } }),

  view(ctx) {
    const u = ctx.user;
    const f = ctx.state.f;
    return html`<div class="split">
      <section class="panel">
        <h2>Account</h2>
        <dl class="facts facts-wide">
          <div><dt>Name</dt><dd>${u.displayName}</dd></div>
          <div><dt>Username</dt><dd><code>${u.username}</code></dd></div>
          <div><dt>Roles</dt><dd>${u.roles.map((r) => ROLE_LABELS[r]).join(', ')}</dd></div>
          <div><dt>Last log-in</dt><dd>${u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : 'This is the first'}</dd></div>
        </dl>
        <p class="hint">An Administrator changes names and roles on the User Accounts page.</p>
      </section>
      <section class="panel">
        <h2>Change your password</h2>
        <form data-action="change" data-scope="change" novalidate>
          ${ctx.errorFor('change')}
          ${requiredLegend()}
          ${field({ id: 'current', label: 'Current password', type: 'password', bind: 'f.current', value: f.current, required: true, invalid: ctx.invalid('Current password', 'current'), autocomplete: 'current-password' })}
          ${field({ id: 'newPassword', label: 'New password', type: 'password', bind: 'f.password', value: f.password, required: true, invalid: ctx.invalid('New password', 'password'), hint: 'At least 8 characters.', autocomplete: 'new-password' })}
          ${field({ id: 'confirmPassword', label: 'Confirm new password', type: 'password', bind: 'f.confirm', value: f.confirm, required: true, invalid: ctx.invalid('Confirm new password', 'confirm'), autocomplete: 'new-password' })}
          <div class="form-actions">${button({ label: 'Change Password', type: 'submit', kind: 'primary' })}</div>
        </form>
      </section>
    </div>`;
  },

  actions: {
    async change(ctx) {
      await ctx.svc.changeOwnPassword(ctx.user.id, ctx.state.f);
      ctx.state.f = { current: '', password: '', confirm: '' };
      ctx.say('ok', 'Your password has been changed.');
      ctx.render();
    },
  },
};
