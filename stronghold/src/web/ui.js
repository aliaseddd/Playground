// HTML templating, formatting and the shared controls every page is built from. Using the same
// pieces everywhere is how like controls act alike (REQ_000_044 to REQ_000_046).
import { localIsoDate, textQueryMatches } from '../core/text.js';

// ---------------------------------------------------------------- templating

const RAW = Symbol('raw');

export function raw(text) {
  return { [RAW]: true, text: String(text) };
}

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function toHtml(value) {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (Array.isArray(value)) return value.map(toHtml).join('');
  if (value[RAW]) return value.text;
  return esc(value);
}

// Tagged template: interpolated values are escaped unless they came from html`` or raw().
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += toHtml(values[i]) + strings[i + 1];
  return raw(out);
}

// Attributes from an object: null/false are left out, true is written bare.
export function attrs(map) {
  return raw(
    Object.entries(map)
      .filter(([, v]) => v !== null && v !== undefined && v !== false)
      .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
      .join(' '),
  );
}

// ---------------------------------------------------------------- formatting

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const longDateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const fmt = {
  date: (iso) => dateFmt.format(new Date(iso)),
  longDate: (iso) => longDateFmt.format(new Date(iso)),
  time: (iso) => timeFmt.format(new Date(iso)),
  dateTime: (iso) => `${dateFmt.format(new Date(iso))}, ${timeFmt.format(new Date(iso))}`,
  // "Today, 9:41 AM", "Yesterday, 4:02 PM" or "3 Oct 2026, 10:15 AM".
  when(iso, now = new Date()) {
    if (!iso) return '';
    const day = localIsoDate(new Date(iso));
    if (day === localIsoDate(now)) return `Today, ${fmt.time(iso)}`;
    const y = new Date(now.getTime());
    y.setDate(y.getDate() - 1);
    if (day === localIsoDate(y)) return `Yesterday, ${fmt.time(iso)}`;
    return fmt.dateTime(iso);
  },
  // The same, for use inside a sentence: "today at 9:41 AM".
  whenInline(iso, now = new Date()) {
    const w = fmt.when(iso, now);
    if (w.startsWith('Today, ')) return `today at ${w.slice(7)}`;
    if (w.startsWith('Yesterday, ')) return `yesterday at ${w.slice(11)}`;
    return `${fmt.date(iso)} at ${fmt.time(iso)}`;
  },
  // A date of birth is a calendar date, not an instant, so it is never shifted by time zone.
  dob(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-').map(Number);
    return dateFmt.format(new Date(y, m - 1, d));
  },
  duration(fromIso, toIso) {
    const minutes = Math.max(0, Math.round((new Date(toIso) - new Date(fromIso)) / 60000));
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h >= 48) return `${Math.floor(h / 24)} days`;
    return m ? `${h} h ${m} min` : `${h} h`;
  },
  visitNo: (n) => String(n).padStart(4, '0'),
  count: (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`,
};

// Value for an <input type="datetime-local"> from an ISO instant, in local time.
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${localIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const SCREENING_LABELS = {
  'no match': 'No match',
  'possible match': 'Possible match',
  match: 'Match',
  'not run': 'Not run',
};
const SCREENING_TONES = { 'no match': 'ok', 'possible match': 'warn', match: 'bad', 'not run': 'muted' };

export const TYPE_LABELS = { visitor: 'Visitor', contractor: 'Contractor' };
export const ROLE_LABELS = { operator: 'Operator', admin: 'Administrator' };

// ---------------------------------------------------------------- icons

const ICONS = {
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 3 2 21h20L12 3zM12 10v5M12 18h.01"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6"/>',
};

export function icon(name) {
  return raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`);
}

// ---------------------------------------------------------------- small pieces

export function screeningPill(outcome) {
  return html`<span class="pill pill-${SCREENING_TONES[outcome] || 'muted'}">${SCREENING_LABELS[outcome] || outcome}</span>`;
}

export function typeTag(type) {
  return html`<span class="tag tag-${type}">${TYPE_LABELS[type] || type}</span>`;
}

export function personLink(person) {
  return html`<a class="name-link" href="#/people/${person.id}">${person.lastName}, ${person.firstName}</a>`;
}

export function requiredLegend() {
  return html`<p class="legend"><span class="req" aria-hidden="true">*</span> marks a required detail.</p>`;
}

export function alertBox(kind, title, body = '') {
  return html`<div class="alert alert-${kind}" role="${kind === 'bad' ? 'alert' : 'status'}"><p class="alert-title">${title}</p>${body ? html`<div class="alert-body">${body}</div>` : ''}</div>`;
}

// The error a form or action ran into. Missing details are listed by name (REQ_000_050).
export function errorSummary(error) {
  const title = error.missing && error.missing.length ? 'Required details are missing' : 'This could not be done';
  return html`<div class="alert alert-bad" role="alert" tabindex="-1" data-error-summary><p class="alert-title">${title}</p><p>${error.message}</p></div>`;
}

// ---------------------------------------------------------------- form controls

function labelHtml(id, label, required) {
  return html`<label for="${id}">${label}${required ? html`<span class="req" aria-hidden="true">*</span><span class="sr"> (required)</span>` : ''}</label>`;
}

export function field({ id, label, bind = null, value = '', type = 'text', required = false, invalid = false, hint = '', autocomplete = null, placeholder = null, extra = {}, rerender = false }) {
  const hintId = hint ? `${id}-hint` : null;
  return html`<div class="field${invalid ? ' is-invalid' : ''}">
    ${labelHtml(id, label, required)}
    <input ${attrs({ id, name: id, type, value: value ?? '', 'data-bind': bind, 'data-rerender': rerender || null, 'aria-required': required ? 'true' : null, 'aria-invalid': invalid ? 'true' : null, 'aria-describedby': hintId, autocomplete, placeholder, ...extra })}>
    ${hint ? html`<p class="hint" id="${hintId}">${hint}</p>` : ''}
  </div>`;
}

export function textareaField({ id, label, bind = null, value = '', required = false, invalid = false, hint = '', rows = 3 }) {
  const hintId = hint ? `${id}-hint` : null;
  return html`<div class="field${invalid ? ' is-invalid' : ''}">
    ${labelHtml(id, label, required)}
    <textarea ${attrs({ id, name: id, rows, 'data-bind': bind, 'aria-required': required ? 'true' : null, 'aria-invalid': invalid ? 'true' : null, 'aria-describedby': hintId })}>${value ?? ''}</textarea>
    ${hint ? html`<p class="hint" id="${hintId}">${hint}</p>` : ''}
  </div>`;
}

export function selectField({ id, label, bind = null, value = '', options, required = false, invalid = false, hint = '', placeholder = 'Choose…', rerender = false }) {
  const hintId = hint ? `${id}-hint` : null;
  return html`<div class="field${invalid ? ' is-invalid' : ''}">
    ${labelHtml(id, label, required)}
    <select ${attrs({ id, name: id, 'data-bind': bind, 'data-rerender': rerender || null, 'aria-required': required ? 'true' : null, 'aria-invalid': invalid ? 'true' : null, 'aria-describedby': hintId })}>
      ${placeholder !== null ? html`<option value="" ${value ? '' : raw('selected')}>${placeholder}</option>` : ''}
      ${options.map((o) => html`<option ${attrs({ value: o.value, selected: String(o.value) === String(value) })}>${o.label}</option>`)}
    </select>
    ${hint ? html`<p class="hint" id="${hintId}">${hint}</p>` : ''}
  </div>`;
}

export function checkboxField({ id, label, bind = null, checked = false, hint = '', rerender = false }) {
  const hintId = hint ? `${id}-hint` : null;
  return html`<div class="field field-check">
    <label class="check" for="${id}"><input ${attrs({ id, name: id, type: 'checkbox', checked, 'data-bind': bind, 'data-rerender': rerender || null, 'aria-describedby': hintId })}><span>${label}</span></label>
    ${hint ? html`<p class="hint" id="${hintId}">${hint}</p>` : ''}
  </div>`;
}

// A row of mutually exclusive choices, such as Visitor / Contractor.
export function choiceField({ name, legend, options, value, bind, required = false }) {
  return html`<fieldset class="choice">
    <legend>${legend}${required ? html`<span class="req" aria-hidden="true">*</span><span class="sr"> (required)</span>` : ''}</legend>
    <div class="choice-row">
      ${options.map((o) => html`<label class="choice-opt${o.value === value ? ' is-on' : ''}${o.tone ? ` tone-${o.tone}` : ''}"><input ${attrs({ type: 'radio', name, value: o.value, checked: o.value === value, 'data-bind': bind, 'data-rerender': true })}><span>${o.label}</span></label>`)}
    </div>
  </fieldset>`;
}

// A button. When it cannot be used, it stays visible, disabled, with the reason beside it
// (REQ_000_041).
export function button({ label, action = null, kind = 'secondary', type = 'button', why = null, id = null, data = {}, iconName = null, name = null, value = null, small = false }) {
  const key = id || [action, ...Object.values(data)].filter(Boolean).join('-');
  const whyId = why ? `${key}-why` : null;
  const dataAttrs = Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v]));
  const btn = html`<button ${attrs({ id, type, name, value, class: `btn btn-${kind}${small ? ' btn-sm' : ''}`, 'data-action': action, disabled: Boolean(why), 'aria-describedby': whyId, ...dataAttrs })}>${iconName ? icon(iconName) : ''}<span>${label}</span></button>`;
  return why ? html`<span class="ctl"><span class="ctl-btn">${btn}</span><span class="why" id="${whyId}">${why}</span></span>` : btn;
}

// ---------------------------------------------------------------- lists

// The one list every page uses: all records load at once, a search box filters them as you
// type, names open records, and an empty list says so in a sentence (REQ_000_045, 048).
export function listView(ctx, cfg) {
  const st = ctx.list(cfg.id);
  const q = st.q.trim();
  const filtered = q && cfg.searchText ? cfg.items.filter((item) => textQueryMatches(cfg.searchText(item), q)) : cfg.items;
  const pageSize = cfg.pageSize || 25;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (st.page >= pages) st.page = pages - 1;
  const shown = filtered.slice(st.page * pageSize, (st.page + 1) * pageSize);
  const ids = new Set(cfg.items.map(cfg.rowId));
  for (const id of [...st.selected]) if (!ids.has(id)) st.selected.delete(id);
  const selectable = Boolean(cfg.selectable);
  const allShownSelected = shown.length > 0 && shown.every((item) => st.selected.has(cfg.rowId(item)));
  const selectedItems = cfg.items.filter((item) => st.selected.has(cfg.rowId(item)));

  let body;
  if (!cfg.items.length) body = html`<p class="empty">${cfg.empty}</p>`;
  else if (!filtered.length) body = html`<p class="empty">No ${cfg.noun} match “${q}”. ${button({ label: 'Clear search', action: 'list-clear', data: { list: cfg.id }, small: true })}</p>`;
  else {
    body = html`<div class="table-wrap"><table class="table">
      <caption class="sr">${cfg.caption || cfg.noun}</caption>
      <thead><tr>
        ${selectable ? html`<th class="col-select"><input ${attrs({ type: 'checkbox', 'data-list-all': cfg.id, checked: allShownSelected, 'aria-label': `Select all ${cfg.noun} on this page` })}></th>` : ''}
        ${cfg.columns.map((c) => html`<th class="${c.cls || ''}" scope="col">${c.label}</th>`)}
      </tr></thead>
      <tbody>
        ${shown.map((item) => {
          const rid = cfg.rowId(item);
          return html`<tr class="${cfg.rowClass ? cfg.rowClass(item) : ''}${st.selected.has(rid) ? ' is-selected' : ''}">
            ${selectable ? html`<td class="col-select"><input ${attrs({ type: 'checkbox', 'data-list-select': cfg.id, value: rid, checked: st.selected.has(rid), 'aria-label': `Select ${cfg.selectLabel ? cfg.selectLabel(item) : rid}` })}></td>` : ''}
            ${cfg.columns.map((c) => html`<td class="${c.cls || ''}" data-label="${c.label}">${c.cell(item)}</td>`)}
          </tr>`;
        })}
      </tbody>
    </table></div>`;
  }

  const from = filtered.length ? st.page * pageSize + 1 : 0;
  const to = Math.min(filtered.length, (st.page + 1) * pageSize);
  const pager =
    pages > 1
      ? html`<div class="pager">
          <span class="pager-count">Showing ${from}–${to} of ${filtered.length}</span>
          ${button({ label: 'Previous page', action: 'list-page', data: { list: cfg.id, page: st.page - 1 }, small: true, why: st.page === 0 ? 'This is the first page.' : null })}
          ${button({ label: 'Next page', action: 'list-page', data: { list: cfg.id, page: st.page + 1 }, small: true, why: st.page >= pages - 1 ? 'This is the last page.' : null })}
        </div>`
      : cfg.items.length
        ? html`<div class="pager"><span class="pager-count">${fmt.count(filtered.length, cfg.nounOne || cfg.noun.replace(/s$/, ''), cfg.noun)}${q ? ` match “${q}”` : ''}</span></div>`
        : '';

  return html`<div class="list" id="${cfg.id}">
    ${cfg.searchText || cfg.toolbar
      ? html`<div class="list-tools">
          ${cfg.searchText
            ? html`<div class="search">
                <label for="${cfg.id}-q">Search ${cfg.noun}</label>
                <div class="search-row">${icon('search')}<input ${attrs({ id: `${cfg.id}-q`, type: 'search', value: st.q, 'data-list-q': cfg.id, placeholder: cfg.searchPlaceholder || 'Type a name', autocomplete: 'off' })}></div>
              </div>`
            : ''}
          ${cfg.toolbar ? html`<div class="list-actions">${cfg.toolbar(selectedItems)}</div>` : ''}
        </div>`
      : ''}
    ${body}
    ${pager}
  </div>`;
}

// ---------------------------------------------------------------- dialogs

function dialogField(f, value, invalid, values) {
  const id = `dlg-${f.name}`;
  f = { ...f, required: isRequired(f, values) };
  switch (f.type) {
    case 'textarea':
      return textareaField({ id, label: f.label, value, required: f.required, invalid, hint: f.hint });
    case 'select':
      return selectField({ id, label: f.label, value, options: f.options, required: f.required, invalid, hint: f.hint, placeholder: f.placeholder ?? 'Choose…' });
    case 'checkbox':
      return checkboxField({ id, label: f.label, checked: Boolean(value), hint: f.hint });
    case 'roles':
      return html`<fieldset class="field roles${invalid ? ' is-invalid' : ''}"><legend>${f.label}${f.required ? html`<span class="req" aria-hidden="true">*</span><span class="sr"> (required)</span>` : ''}</legend>
        ${Object.entries(ROLE_LABELS).map(([r, l]) => html`<label class="check"><input ${attrs({ type: 'checkbox', name: `dlg-${f.name}`, value: r, checked: (value || []).includes(r) })}><span>${l}</span></label>`)}
        ${f.hint ? html`<p class="hint">${f.hint}</p>` : ''}</fieldset>`;
    default:
      return field({ id, label: f.label, value, type: f.type || 'text', required: f.required, invalid, hint: f.hint, autocomplete: f.autocomplete || 'off', extra: f.extra || {} });
  }
}

function isRequired(f, values) {
  return typeof f.required === 'function' ? Boolean(f.required(values)) : Boolean(f.required);
}

// A modal form for confirmations and small edits (REQ_000_051). `onConfirm(values)` runs the
// action; if it throws, the dialog stays open and shows why. Resolves the action's result, or
// null when cancelled.
export function openDialog({ title, intro = '', fields = [], confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel', onConfirm = null }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-backdrop';
    const values = Object.fromEntries(fields.map((f) => [f.name, f.value ?? (f.type === 'checkbox' ? false : f.type === 'roles' ? [] : '')]));
    let error = null;
    let busy = false;

    const draw = (focusId = null) => {
      const missing = (error && error.missing) || [];
      overlay.innerHTML = toHtml(html`<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <form data-dialog novalidate>
          <h2 id="dlg-title">${title}</h2>
          ${intro ? html`<div class="dialog-intro">${intro}</div>` : ''}
          ${error ? errorSummary(error) : ''}
          ${fields.some((f) => isRequired(f, values)) ? requiredLegend() : ''}
          ${fields.filter((f) => !f.showIf || f.showIf(values)).map((f) => dialogField(f, values[f.name], missing.includes(f.label) || (error && error.field === f.name), values))}
          <div class="form-actions">
            <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${confirmLabel}</button>
            <button type="button" class="btn btn-secondary" data-cancel>${cancelLabel}</button>
          </div>
        </form>
      </div>`);
      const target =
        (focusId && overlay.querySelector(`#${CSS.escape(focusId)}`)) ||
        overlay.querySelector('[data-error-summary]') ||
        overlay.querySelector('input:not([type=hidden]), textarea, select') ||
        overlay.querySelector('button[type=submit]');
      if (target) target.focus();
    };

    const close = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (previous && previous.isConnected && previous.focus) previous.focus();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        close(null);
      }
      if (e.key === 'Tab') {
        const focusable = [...overlay.querySelectorAll('input, select, textarea, button')].filter((el) => !el.disabled);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const capture = (e) => {
      const t = e.target;
      const name = (t.name || '').replace(/^dlg-/, '');
      if (!(name in values)) return;
      const f = fields.find((x) => x.name === name);
      if (f.type === 'checkbox') values[name] = t.checked;
      else if (f.type === 'roles') values[name] = [...overlay.querySelectorAll(`input[name="dlg-${name}"]:checked`)].map((i) => i.value);
      else values[name] = t.value;
      if (f.redraw && e.type === 'change') draw(t.id);
    };
    overlay.addEventListener('input', capture);
    overlay.addEventListener('change', capture);
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-cancel]') && !busy) close(null);
    });
    overlay.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const missing = fields
        .filter((f) => (!f.showIf || f.showIf(values)) && isRequired(f, values))
        .filter((f) => (f.type === 'roles' ? !values[f.name].length : !String(values[f.name] ?? '').trim()))
        .map((f) => f.label);
      if (missing.length) {
        error = { message: `Fill in the required ${missing.length === 1 ? 'detail' : 'details'}: ${missing.join(', ')}.`, missing };
        draw();
        return;
      }
      busy = true;
      overlay.querySelector('.dialog').setAttribute('aria-busy', 'true');
      try {
        const result = onConfirm ? await onConfirm({ ...values }) : { ...values };
        close(result === undefined ? true : result);
      } catch (err) {
        busy = false;
        error = { message: err.message || String(err), missing: err.missing || [], field: err.field || null };
        if (!err.name || err.name !== 'UserError') console.error(err);
        draw();
      }
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    draw();
  });
}
