// Audit Log: decisions, corrections, deletions and administration changes (REQ_000_037).
import { html, listView, fmt, selectField, SCREENING_LABELS, TYPE_LABELS, ROLE_LABELS } from '../ui.js';

const KINDS = {
  decision: 'Decision',
  'visit-correction': 'Visit correction',
  'person-change': 'Person change',
  deletion: 'Deletion',
  watchlist: 'Watchlist',
  destination: 'Destination',
  account: 'Account',
  settings: 'Settings',
  backup: 'Backup',
  setup: 'Setup',
};

const FIELD_LABELS = {
  signInAt: 'Signed in',
  signOutAt: 'Signed out',
  destination: 'Destination',
  firstName: 'First name',
  lastName: 'Last name',
  dob: 'Date of birth',
  type: 'Person type',
  company: 'Company',
  siteName: 'Building name',
  retentionDays: 'Retention period',
  watchlistAvailable: 'Watchlist screening',
  displayName: 'Name',
  roles: 'Roles',
};

function show(key, value) {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (key === 'signInAt' || key === 'signOutAt') return fmt.dateTime(value);
  if (key === 'dob') return fmt.dob(value);
  if (key === 'type') return TYPE_LABELS[value] || value;
  if (key === 'roles') return value.map((r) => ROLE_LABELS[r]).join(', ');
  if (key === 'watchlistAvailable') return value ? 'On' : 'Off';
  if (key === 'retentionDays') return `${value} days`;
  return String(value);
}

function changes(d) {
  if (d.fields) return html`<p><span class="detail-label">Changed:</span> ${d.fields.map((k) => FIELD_LABELS[k] || k).join(', ')}</p>`;
  if (!d.before && !d.after) return '';
  const keys = [...new Set([...Object.keys(d.before || {}), ...Object.keys(d.after || {})])];
  if (typeof d.before === 'string') return html`<p>${d.before} → ${d.after}</p>`;
  return html`<table class="table table-compact"><thead><tr><th scope="col">Detail</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>
    ${keys.map((k) => html`<tr><td>${FIELD_LABELS[k] || k}</td><td>${d.before ? show(k, d.before[k]) : ''}</td><td>${d.after ? show(k, d.after[k]) : ''}</td></tr>`)}
  </tbody></table>`;
}

function details(a) {
  const d = a.data || {};
  const parts = [];
  if (a.kind === 'decision') {
    parts.push(html`<dl class="facts">
      <div><dt>Decision</dt><dd>${d.decision === 'admit' ? 'Admitted' : 'Refused'}</dd></div>
      <div><dt>Screening result</dt><dd>${SCREENING_LABELS[d.screening] || d.screening}</dd></div>
      <div><dt>Person</dt><dd>${d.person.firstName} ${d.person.lastName}, born ${fmt.dob(d.person.dob)}</dd></div>
      ${d.heldBy ? html`<div><dt>Held</dt><dd>${fmt.dateTime(d.heldAt)} by ${d.heldBy.name}</dd></div>` : ''}
      ${d.visitNumber ? html`<div><dt>Visit</dt><dd>${fmt.visitNo(d.visitNumber)}</dd></div>` : ''}
    </dl>`);
    if (d.cause) parts.push(html`<p>Screening did not run because ${d.cause}.</p>`);
    if (d.matches && d.matches.length) {
      parts.push(html`<p class="detail-label">Matching watchlist entries</p><ul>${d.matches.map((m) => html`<li>${m.firstName} ${m.lastName}, born ${fmt.dob(m.dob)}${m.dobMatches ? ' (date of birth matches)' : ''}</li>`)}</ul>`);
    }
  }
  if (a.kind === 'deletion') {
    parts.push(html`<dl class="facts"><div><dt>Kind of record</dt><dd>${d.recordKind}</dd></div>${d.recordId ? html`<div><dt>Identifier</dt><dd><code>${d.recordId}</code></dd></div>` : ''}${d.visitNumber ? html`<div><dt>Visit</dt><dd>${fmt.visitNo(d.visitNumber)}</dd></div>` : ''}${d.name ? html`<div><dt>Name</dt><dd>${d.name}</dd></div>` : ''}</dl>`);
    if (d.records) parts.push(html`<p>${fmt.count(d.records.length, 'record')} removed.</p>`);
  }
  parts.push(changes(d));
  if (d.reason) parts.push(html`<p><span class="detail-label">Reason:</span> ${d.reason}</p>`);
  const body = parts.filter(Boolean);
  if (!body.length || body.every((p) => p === '')) return '';
  return html`<details class="audit-details"><summary>Details</summary>${body}</details>`;
}

export const auditPage = {
  id: 'audit',
  name: 'Audit Log',
  liveRefresh: true,
  title: () => 'Audit Log',
  lede: () => 'Every decision on a held sign-in, every change to a recorded visit, every deletion and every change an Administrator makes, newest first. Entries cannot be changed or removed.',

  init: () => ({ kind: '' }),

  view(ctx) {
    const kind = ctx.state.kind;
    const entries = ctx.svc.auditLog(ctx.user.id).filter((a) => !kind || a.kind === kind);
    return html`
      <div class="filter-row">
        ${selectField({ id: 'auditKind', label: 'Show', bind: 'kind', value: kind, rerender: true, placeholder: 'Every kind of entry', options: Object.entries(KINDS).map(([value, label]) => ({ value, label })) })}
      </div>
      ${listView(ctx, {
        id: 'audit',
        noun: 'entries',
        nounOne: 'entry',
        pageSize: 50,
        items: entries,
        rowId: (a) => a.id,
        searchText: (a) => `${a.summary} ${a.actor.name} ${(a.data && a.data.reason) || ''}`,
        searchPlaceholder: 'Words in the entry, or a name',
        empty: kind ? `The log has no ${KINDS[kind].toLowerCase()} entries.` : 'The log is empty.',
        columns: [
          { label: 'When', cls: 'num nowrap', cell: (a) => fmt.dateTime(a.at) },
          { label: 'Who', cell: (a) => html`${a.actor.name}${a.actor.username ? html` <span class="muted">${a.actor.username}</span>` : ''}` },
          { label: 'Kind', cell: (a) => html`<span class="tag tag-plain">${KINDS[a.kind] || a.kind}</span>` },
          { label: 'What happened', cls: 'wide', cell: (a) => html`<span>${a.summary}</span>${details(a)}` },
        ],
      })}`;
  },

  actions: {},
};
