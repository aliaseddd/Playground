// Mounts one page: renders it from its state, binds inputs to that state, and runs its actions
// with the same error handling everywhere.
//
// A page is { id, title(ctx), lede?(ctx), init?(ctx), view(ctx), actions: { name(ctx, el, event, values) } }.
// Inputs with data-bind="a.b" write into ctx.state.a.b; data-rerender re-renders on change.
// Elements with data-action="name" (buttons) or forms with data-action run actions.
// A page with keepState keeps its state while the user visits other pages and comes back;
// its restore(ctx, kept) may refuse a kept state that no longer makes sense.
import { html, toHtml, errorSummary, alertBox } from './ui.js';

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

function inputValue(el) {
  if (el.type === 'checkbox') return el.checked;
  return el.value;
}

export function mountPage(app, page, params = {}) {
  const root = document.createElement('div');
  root.className = `page page-${page.id}`;

  const ctx = {
    app,
    svc: app.svc,
    get user() {
      return app.user;
    },
    params,
    root,
    page,
    state: {},
    lists: new Map(),
    error: null,
    flash: app.takeFlash(),
    busy: false,
    focusError: false,
    _errorShown: false,
    list(id) {
      if (!this.lists.has(id)) this.lists.set(id, { q: '', page: 0, selected: new Set() });
      return this.lists.get(id);
    },
    // True when the current error names this detail (by label) or this field (by key).
    invalid(label, key = null) {
      const e = this.error;
      return Boolean(e && ((e.missing || []).includes(label) || (key && e.field === key)));
    },
    // Shows the current error here if it came from the given action(s).
    errorFor(...scopes) {
      if (!this.error || !scopes.includes(this.error.scope)) return '';
      this._errorShown = true;
      return errorSummary(this.error);
    },
    say(kind, title, body = '') {
      this.flash = { kind, title, body };
    },
    render,
  };

  function render() {
    const active = document.activeElement;
    const focusId = active && root.contains(active) && active.id ? active.id : null;
    let caret = null;
    try {
      if (focusId && typeof active.selectionStart === 'number') caret = [active.selectionStart, active.selectionEnd];
    } catch {
      caret = null;
    }
    ctx._errorShown = false;
    if (page.keepState) app.pageStates[page.id] = ctx.state;
    let body;
    try {
      body = page.view(ctx);
    } catch (e) {
      console.error(e);
      body = alertBox('bad', 'This page could not be shown', e.message);
    }
    root.innerHTML = toHtml(html`
      <header class="page-head">
        <h1 tabindex="-1">${page.title(ctx)}</h1>
        ${page.lede ? html`<p class="lede">${page.lede(ctx)}</p>` : ''}
      </header>
      <div class="page-flash" aria-live="polite">${ctx.flash ? alertBox(ctx.flash.kind, ctx.flash.title, ctx.flash.body) : ''}</div>
      ${ctx.error && !ctx._errorShown ? errorSummary(ctx.error) : ''}
      ${body}`);
    if (ctx.focusError) {
      ctx.focusError = false;
      const summary = root.querySelector('[data-error-summary]');
      if (summary) {
        summary.focus();
        return;
      }
    }
    if (ctx.focusAfter) {
      const el = root.querySelector(ctx.focusAfter);
      ctx.focusAfter = null;
      if (el) {
        el.focus();
        return;
      }
    }
    if (focusId) {
      const el = root.querySelector(`#${CSS.escape(focusId)}`);
      if (el) {
        el.focus();
        if (caret) {
          try {
            el.setSelectionRange(caret[0], caret[1]);
          } catch {
            /* not a text input */
          }
        }
      }
    }
  }

  async function dispatch(name, el, event) {
    const fn = page.actions && page.actions[name];
    if (!fn) {
      console.warn(`No action "${name}" on page ${page.id}`);
      return;
    }
    if (ctx.busy) return;
    ctx.busy = true;
    root.setAttribute('aria-busy', 'true');
    ctx.error = null;
    ctx.flash = null;
    const values = el.tagName === 'FORM' ? Object.fromEntries(new FormData(el)) : null;
    try {
      await fn(ctx, el, event, values);
    } catch (err) {
      if (err && err.code === 'session') {
        app.endSession(err.message);
        return;
      }
      if (!err || err.name !== 'UserError') console.error(err);
      ctx.error = { message: (err && err.message) || String(err), missing: (err && err.missing) || [], field: (err && err.field) || null, scope: (el.dataset && el.dataset.scope) || name };
      ctx.focusError = true;
      render();
    } finally {
      ctx.busy = false;
      root.removeAttribute('aria-busy');
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.dataset.listQ !== undefined) {
      if (e.type !== 'input') return;
      const st = ctx.list(t.dataset.listQ);
      st.q = t.value;
      st.page = 0;
      render();
      return;
    }
    if (t.dataset.listSelect !== undefined) {
      if (e.type !== 'change') return;
      const st = ctx.list(t.dataset.listSelect);
      if (t.checked) st.selected.add(t.value);
      else st.selected.delete(t.value);
      render();
      return;
    }
    if (t.dataset.listAll !== undefined) {
      if (e.type !== 'change') return;
      const st = ctx.list(t.dataset.listAll);
      const boxes = root.querySelectorAll(`[data-list-select="${CSS.escape(t.dataset.listAll)}"]`);
      for (const b of boxes) {
        if (t.checked) st.selected.add(b.value);
        else st.selected.delete(b.value);
      }
      render();
      return;
    }
    if (t.dataset.bind) {
      if (t.type === 'radio' && !t.checked) return;
      setPath(ctx.state, t.dataset.bind, inputValue(t));
      if (t.dataset.rerender !== undefined && e.type === 'change') render();
    }
  }

  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el) || el.tagName === 'FORM' || el.disabled) return;
    e.preventDefault();
    const name = el.dataset.action;
    if (name === 'list-clear') {
      const st = ctx.list(el.dataset.list);
      st.q = '';
      st.page = 0;
      ctx.focusAfter = `#${CSS.escape(el.dataset.list)}-q`;
      render();
      return;
    }
    if (name === 'list-page') {
      ctx.list(el.dataset.list).page = Number(el.dataset.page);
      render();
      return;
    }
    dispatch(name, el, e);
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.action) dispatch(form.dataset.action, form, e);
  });

  const kept = page.keepState ? app.pageStates[page.id] : null;
  ctx.state = kept && (!page.restore || page.restore(ctx, kept)) ? kept : page.init ? page.init(ctx) || {} : {};
  ctx.dispatch = dispatch;
  render();
  return ctx;
}
