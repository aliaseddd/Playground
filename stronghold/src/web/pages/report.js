// Sign-In Report: every visit whose sign-in time falls within a date range (REQ_000_026).
import { html, field, selectField, button, listView, fmt, typeTag, screeningPill, personLink, requiredLegend, TYPE_LABELS } from '../ui.js';
import { localIsoDate, toCsv } from '../../core/text.js';
import { saveFile } from '../env.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

// "2026-10-12 09:41" in local time, a form spreadsheets read as a date and time.
function sheetTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${localIsoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function range(kind) {
  const now = new Date();
  const day = (offset) => {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + offset);
    return localIsoDate(d);
  };
  switch (kind) {
    case 'yesterday':
      return [day(-1), day(-1)];
    case 'week':
      return [day(-6), day(0)];
    case 'month':
      return [`${localIsoDate(now).slice(0, 8)}01`, day(0)];
    default:
      return [day(0), day(0)];
  }
}

function describe(r) {
  const span = r.from === r.to ? fmt.longDate(`${r.from}T12:00:00`) : `${fmt.date(`${r.from}T12:00:00`)} to ${fmt.date(`${r.to}T12:00:00`)}`;
  const filters = [r.type ? `${TYPE_LABELS[r.type]}s only` : '', r.destination ? `destination ${r.destination}` : ''].filter(Boolean);
  return `${span}${filters.length ? ` · ${filters.join(' · ')}` : ''}`;
}

export const reportPage = {
  id: 'report',
  name: 'Sign-In Report',
  liveRefresh: true,
  title: () => 'Sign-In Report',
  lede: () => 'Every visit that began within a date range, with who signed each person in and out.',

  init() {
    const [from, to] = range('today');
    const criteria = { from, to, type: '', destination: '' };
    return { ...criteria, ran: { ...criteria } };
  },

  view(ctx) {
    const s = ctx.state;
    const destinations = ctx.svc.usedDestinations(ctx.user.id);
    let report = null;
    try {
      report = s.ran ? ctx.svc.report(ctx.user.id, s.ran) : null;
    } catch {
      report = null;
    }
    const rows = report ? report.rows : [];
    const byType = rows.reduce((acc, r) => ({ ...acc, [r.person.type]: (acc[r.person.type] || 0) + 1 }), {});
    const stillIn = rows.filter((r) => !r.visit.signOutAt).length;

    return html`
      <section class="panel">
        <form class="report-form" data-action="run" data-scope="run" novalidate>
          ${ctx.errorFor('run')}
          ${requiredLegend()}
          <div class="report-fields">
            ${field({ id: 'from', label: 'From', type: 'date', bind: 'from', value: s.from, required: true, invalid: ctx.invalid('From', 'from') })}
            ${field({ id: 'to', label: 'To', type: 'date', bind: 'to', value: s.to, required: true, invalid: ctx.invalid('To', 'to') })}
            ${selectField({ id: 'rtype', label: 'Person type', bind: 'type', value: s.type, placeholder: 'All types', options: [{ value: 'visitor', label: 'Visitors' }, { value: 'contractor', label: 'Contractors' }] })}
            ${selectField({ id: 'rdest', label: 'Destination', bind: 'destination', value: s.destination, placeholder: 'All destinations', options: destinations.map((d) => ({ value: d, label: d })) })}
          </div>
          <div class="form-actions">
            ${button({ label: 'Run Report', type: 'submit', kind: 'primary' })}
            <span class="quick">Quick ranges:
              ${button({ label: 'Today', action: 'quick', data: { range: 'today' }, small: true, kind: 'ghost' })}
              ${button({ label: 'Yesterday', action: 'quick', data: { range: 'yesterday' }, small: true, kind: 'ghost' })}
              ${button({ label: 'Last 7 Days', action: 'quick', data: { range: 'week' }, small: true, kind: 'ghost' })}
              ${button({ label: 'This Month', action: 'quick', data: { range: 'month' }, small: true, kind: 'ghost' })}
            </span>
          </div>
        </form>
      </section>
      ${
        report
          ? html`<section class="report-result" aria-labelledby="report-title">
              <div class="report-summary">
                <div>
                  <h2 id="report-title">${fmt.count(rows.length, 'visit')}</h2>
                  <p class="muted">${describe(report)}</p>
                </div>
                <dl class="tallies">
                  <div><dt>Visitors</dt><dd>${byType.visitor || 0}</dd></div>
                  <div><dt>Contractors</dt><dd>${byType.contractor || 0}</dd></div>
                  <div><dt>Still signed in</dt><dd>${stillIn}</dd></div>
                </dl>
                ${button({ label: 'Export CSV', action: 'export', iconName: 'file', id: 'export-csv', why: rows.length ? null : 'The report has no visits to export.' })}
              </div>
              ${listView(ctx, {
                id: 'report-rows',
                noun: 'visits',
                nounOne: 'visit',
                pageSize: 50,
                items: rows,
                rowId: (r) => r.visit.id,
                searchText: (r) => `${r.person.firstName} ${r.person.lastName} ${r.person.company || ''} ${r.visit.destination}`,
                searchPlaceholder: 'Name, company or destination',
                empty: 'No visits began in this range.',
                columns: [
                  { label: 'No.', cls: 'num', cell: (r) => fmt.visitNo(r.visit.number) },
                  { label: 'Signed in', cls: 'num', cell: (r) => fmt.dateTime(r.visit.signInAt) },
                  { label: 'Signed out', cls: 'num', cell: (r) => (r.visit.signOutAt ? fmt.dateTime(r.visit.signOutAt) : html`<span class="pill pill-in">In the building</span>`) },
                  { label: 'Name', cell: (r) => personLink(r.person) },
                  { label: 'Type', cell: (r) => typeTag(r.person.type) },
                  { label: 'Company', cell: (r) => r.person.company || '' },
                  { label: 'Destination', cell: (r) => r.visit.destination },
                  { label: 'Signed in by', cell: (r) => r.visit.signedInBy.name },
                  { label: 'Screening', cell: (r) => screeningPill(r.visit.screening) },
                ],
              })}
            </section>`
          : ''
      }`;
  },

  actions: {
    run(ctx) {
      const s = ctx.state;
      const criteria = { from: s.from, to: s.to, type: s.type, destination: s.destination };
      ctx.svc.report(ctx.user.id, criteria); // validates; throws with the reason
      s.ran = criteria;
      ctx.list('report-rows').page = 0;
      ctx.render();
    },

    quick(ctx, el) {
      const s = ctx.state;
      [s.from, s.to] = range(el.dataset.range);
      s.ran = { from: s.from, to: s.to, type: s.type, destination: s.destination };
      ctx.list('report-rows').page = 0;
      ctx.render();
    },

    async export(ctx) {
      const report = ctx.svc.report(ctx.user.id, ctx.state.ran);
      const csv = toCsv(
        ['Visit number', 'Signed in', 'Signed out', 'Last name', 'First name', 'Person type', 'Company', 'Destination', 'Signed in by', 'Signed out by', 'Screening'],
        report.rows.map((r) => [
          r.visit.number,
          sheetTime(r.visit.signInAt),
          sheetTime(r.visit.signOutAt),
          r.person.lastName,
          r.person.firstName,
          TYPE_LABELS[r.person.type],
          r.person.company || '',
          r.visit.destination,
          r.visit.signedInBy.name,
          r.visit.signedOutBy ? r.visit.signedOutBy.name : '',
          r.visit.screening,
        ]),
      );
      const name = `sign-in-report-${report.from}-to-${report.to}.csv`;
      const result = await saveFile(name, csv, 'text/csv');
      ctx.say(result === 'saved' ? 'ok' : 'info', result === 'saved' ? `Saved ${name}. The file holds personal details; keep it where only desk staff can open it.` : 'The file was not saved.');
      ctx.render();
    },
  },
};
