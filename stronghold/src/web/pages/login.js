import { html, field, button, requiredLegend } from '../ui.js';

export const loginPage = {
  id: 'login',
  name: 'Log In',
  title: () => 'Log In',
  lede: (ctx) => `Visitor management for ${ctx.svc.settings().siteName}.`,

  init: () => ({ f: {} }),

  view(ctx) {
    const s = ctx.state;
    return html`<section class="panel panel-narrow">
      <form data-action="login" novalidate>
        ${ctx.errorFor('login')}
        ${requiredLegend()}
        ${field({ id: 'username', bind: 'f.username', value: s.f.username, label: 'Username', required: true, invalid: ctx.invalid('Username'), autocomplete: 'username' })}
        ${field({ id: 'password', bind: 'f.password', value: '', label: 'Password', type: 'password', required: true, invalid: ctx.invalid('Password'), autocomplete: 'current-password' })}
        <div class="form-actions">${button({ label: 'Log In', kind: 'primary', type: 'submit' })}</div>
      </form>
      <p class="hint">Forgotten your password? An Administrator can set a new one on the User Accounts page.</p>
    </section>`;
  },

  actions: {
    async login(ctx, form, event, values) {
      const user = await ctx.svc.logIn(values.username, values.password);
      ctx.app.logIn(user);
    },
  },
};
