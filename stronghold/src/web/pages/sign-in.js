// Sign In: find or enter a person, screen them, and sign them in with a badge, all on this one
// page (REQ_000_005). A hold and its decision also happen here.
import { html, field, selectField, choiceField, button, requiredLegend, alertBox, fmt, typeTag, screeningPill, icon, attrs, TYPE_LABELS } from '../ui.js';
import { holdPanel, admittedPanel, refusedPanel, decideFromForm, showAdmitted } from './outcome.js';
import { printBadge, afterPaint } from '../print.js';
import { printing, prefs } from '../env.js';
import { localIsoDate } from '../../core/text.js';
import { SAMPLE_TRIES } from '../../core/sample.js';

const OTHER = '__other';
const PLURAL = { visitor: 'visitors', contractor: 'contractors' };

function fresh(type = 'visitor') {
  return {
    type,
    query: '',
    searched: '',
    mode: null, // 'returning' or 'manual': how the person was chosen
    step: 'search', // search | returning | manual | duplicates | screened | held | done | refused
    personId: null,
    entry: { firstName: '', lastName: '', dob: '', company: '' },
    dest: { choice: '', text: '' },
    print: false,
    confirmNew: false,
    duplicates: [],
    screening: null,
    hold: null,
    outcome: null,
    reasons: {},
  };
}

function nextButton() {
  return button({ label: 'Sign In Another Person', action: 'reset', kind: 'primary', id: 'next-person' });
}

function destinationField(ctx) {
  const s = ctx.state;
  const list = ctx.svc.listDestinations(ctx.user.id);
  const options = [...list.map((d) => ({ value: d.id, label: d.name })), { value: OTHER, label: 'Other: type a destination for this visit only' }];
  return html`${selectField({
    id: 'destination',
    label: 'Destination',
    bind: 'dest.choice',
    value: s.dest.choice,
    options,
    required: true,
    rerender: true,
    invalid: ctx.invalid('Destination', 'destination'),
    hint: list.length ? 'Choose from the list the Administrator keeps. Other is for a destination not on the list.' : 'The destination list is empty. An Administrator can add destinations on the Destinations page. Until then, choose Other and type one.',
  })}
  ${
    s.dest.choice === OTHER
      ? field({ id: 'destinationText', label: 'Destination for this visit', bind: 'dest.text', value: s.dest.text, required: true, invalid: ctx.invalid('Destination', 'destinationText'), hint: 'Used for this visit only. It is not added to the destination list.' })
      : ''
  }`;
}

function submitRow() {
  return html`<div class="form-actions submit-row">
      <button type="submit" name="intent" value="print" class="btn btn-primary btn-print" data-intent="print">${icon('print')}<span>Submit &amp; Print</span></button>
      <button type="submit" name="intent" value="submit" class="btn btn-outline" data-intent="submit"><span>Submit</span></button>
      ${button({ label: 'Cancel', action: 'cancel', kind: 'ghost', id: 'cancel-entry' })}
    </div>
    <p class="hint">Submit &amp; Print signs the person in and prints a badge. Submit signs them in without one; Print Badge on their record prints it later. Cancel clears the form without signing anyone in.${printing.note ? ` ${printing.note}` : ''}</p>`;
}

function buildInput(s) {
  const dest = s.dest.choice === OTHER ? { destinationMode: 'typed', destinationText: s.dest.text } : { destinationMode: 'list', destinationId: s.dest.choice };
  if (s.mode === 'returning') return { personId: s.personId, ...dest, print: s.print };
  return { person: { type: s.type, ...s.entry }, ...dest, print: s.print, confirmNew: s.confirmNew };
}

// Shows the screening result, then records the sign-in or the hold for exactly that result
// (REQ_000_017). If the result changed in between, the new one is shown and used instead.
async function screenAndCommit(ctx) {
  const s = ctx.state;
  const back = s.mode;
  let printVisit = null;
  try {
    const input = buildInput(s);
    const screened = ctx.svc.screenSignIn(ctx.user.id, input);
    if (screened.status === 'duplicates') {
      s.duplicates = screened.candidates;
      s.step = 'duplicates';
      ctx.render();
      return;
    }
    let screening = screened.screening;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      s.screening = screening;
      s.step = 'screened';
      ctx.render();
      const result = await ctx.svc.commitSignIn(ctx.user.id, input, screening.outcome);
      if (result.status === 'rescreened') {
        screening = result.screening;
        continue;
      }
      if (result.status === 'duplicates') {
        s.duplicates = result.candidates;
        s.step = 'duplicates';
        ctx.render();
        return;
      }
      if (result.status === 'held') {
        s.hold = result.hold;
        s.step = 'held';
        ctx.focusAfter = `#reason-${CSS.escape(result.hold.id)}`;
        ctx.render();
        return;
      }
      s.outcome = { person: result.person, visit: result.visit, next: nextButton() };
      s.step = 'done';
      ctx.focusAfter = '#done-title';
      ctx.render();
      if (input.print) printVisit = result.visit.id;
      break;
    }
  } catch (e) {
    s.step = back;
    throw e;
  }
  // The visit is recorded; printing comes after and cannot undo it.
  if (printVisit) {
    const outcome = s.outcome;
    outcome.printResult = await afterPaint(() => printBadge(ctx.svc, ctx.user.id, printVisit));
    ctx.render();
  }
}

function searchSection(ctx) {
  const s = ctx.state;
  return html`<section class="panel step" aria-labelledby="find-title">
    <h2 id="find-title" class="sr">Find a person</h2>
    ${choiceField({
      name: 'ptype',
      legend: 'Person type',
      bind: 'type',
      value: s.type,
      options: [
        { value: 'visitor', label: 'Visitor', tone: 'visitor' },
        { value: 'contractor', label: 'Contractor', tone: 'contractor' },
      ],
    })}
    <form class="find" data-action="find" data-scope="find" novalidate>
      ${ctx.errorFor('find')}
      <div class="find-row">
        ${field({ id: 'query', label: `Find a ${TYPE_LABELS[s.type].toLowerCase()} by name`, bind: 'query', value: s.query, required: true, invalid: ctx.invalid('Name'), autocomplete: 'off', placeholder: 'First or last name', extra: { type: 'search' } })}
        <div class="find-buttons">
          ${button({ label: 'Find', type: 'submit', kind: 'primary', iconName: 'search' })}
          ${button({ label: 'Manual Entry', action: 'manual', iconName: 'plus', id: 'manual-entry' })}
        </div>
      </div>
    </form>
    ${resultsView(ctx)}
  </section>`;
}

function statusCell(row) {
  if (row.status === 'in') return html`<span class="pill pill-in">Signed in</span> <span class="muted">${fmt.when(row.openVisit.signInAt)}</span>`;
  if (row.status === 'held') return html`<span class="pill pill-warn">Sign-in held</span>`;
  return html`<span class="muted">Not signed in</span>`;
}

function resultsView(ctx) {
  const s = ctx.state;
  if (!s.searched || s.step !== 'search') return '';
  let found;
  try {
    found = ctx.svc.findPeople(ctx.user.id, { query: s.searched, type: s.type });
  } catch (e) {
    return alertBox('bad', e.message);
  }
  const others = Object.entries(found.otherTypes).map(
    ([t, n]) => html`<p class="note">${n === 1 ? `1 ${TYPE_LABELS[t].toLowerCase()} also matches` : `${n} ${PLURAL[t]} also match`} “${s.searched}”. ${button({ label: `Show ${TYPE_LABELS[t]}s`, action: 'switch-type', data: { type: t }, small: true })}</p>`,
  );
  const plural = PLURAL[s.type];
  if (!found.results.length) {
    return html`<div class="results" aria-live="polite">
      <p class="empty">No ${plural} match “${s.searched}”. If this is their first visit, use Manual Entry.</p>
      ${others}
    </div>`;
  }
  const contractor = s.type === 'contractor';
  return html`<div class="results" aria-live="polite">
    <p class="results-count">${fmt.count(found.results.length, TYPE_LABELS[s.type].toLowerCase(), plural)} ${found.results.length === 1 ? 'matches' : 'match'} “${s.searched}”. Check the date of birth before choosing; people can share a name.</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Name</th><th scope="col">Date of birth</th>${contractor ? html`<th scope="col">Company</th>` : ''}<th scope="col">Last visit</th><th scope="col">Status</th><th scope="col"><span class="sr">Action</span></th></tr></thead>
      <tbody>
        ${found.results.map(
          (r) => html`<tr>
            <td data-label="Name"><a class="name-link" href="#/people/${r.id}">${r.lastName}, ${r.firstName}</a></td>
            <td data-label="Date of birth" class="num">${fmt.dob(r.dob)}</td>
            ${contractor ? html`<td data-label="Company">${r.company}</td>` : ''}
            <td data-label="Last visit" class="num">${r.lastVisitAt ? fmt.date(r.lastVisitAt) : 'Never'}</td>
            <td data-label="Status">${statusCell(r)}</td>
            <td class="col-action">${button({
              label: 'Select',
              action: 'select',
              data: { person: r.id },
              kind: 'primary',
              small: true,
              why: r.status === 'in' ? 'Already signed in. Sign them out on Currently Signed In first.' : r.status === 'held' ? 'A sign-in is waiting for a decision on Held Sign-Ins.' : null,
            })}</td>
          </tr>`,
        )}
      </tbody>
    </table></div>
    ${others}
    <p class="hint">Not in the list? ${button({ label: 'Manual Entry', action: 'manual', small: true, id: 'manual-entry-2' })}</p>
  </div>`;
}

function returningSection(ctx) {
  const s = ctx.state;
  let person;
  try {
    person = ctx.svc.getPerson(ctx.user.id, s.personId).person;
  } catch (e) {
    return alertBox('bad', e.message, button({ label: 'Start Again', action: 'reset' }));
  }
  return html`<section class="panel step" aria-labelledby="returning-title">
    <p class="eyebrow">Returning ${TYPE_LABELS[person.type].toLowerCase()}</p>
    <h2 id="returning-title">Sign in ${person.firstName} ${person.lastName}</h2>
    <dl class="facts">
      <div><dt>Person type</dt><dd>${typeTag(person.type)}</dd></div>
      <div><dt>Date of birth</dt><dd>${fmt.dob(person.dob)}</dd></div>
      ${person.company ? html`<div><dt>Company</dt><dd>${person.company}</dd></div>` : ''}
      <div><dt>Visits</dt><dd>${person.visitCount}${person.lastVisitAt ? `, last ${fmt.date(person.lastVisitAt)}` : ''}</dd></div>
    </dl>
    <p class="hint">Details are taken from the record and are not typed again. To correct them, use Edit Details on the <a href="#/people/${person.id}">record</a>.</p>
    <form data-action="submit" data-scope="submit" novalidate>
      ${ctx.errorFor('submit')}
      ${requiredLegend()}
      ${destinationField(ctx)}
      ${submitRow()}
    </form>
  </section>`;
}

function manualSection(ctx) {
  const s = ctx.state;
  const e = s.entry;
  const label = TYPE_LABELS[s.type];
  return html`<section class="panel step" aria-labelledby="manual-title">
    <p class="eyebrow">Manual entry</p>
    <h2 id="manual-title">New ${label.toLowerCase()}</h2>
    <form data-action="submit" data-scope="submit" novalidate>
      ${ctx.errorFor('submit')}
      ${requiredLegend()}
      <div class="grid-2">
        ${field({ id: 'firstName', label: 'First name', bind: 'entry.firstName', value: e.firstName, required: true, invalid: ctx.invalid('First name'), autocomplete: 'off' })}
        ${field({ id: 'lastName', label: 'Last name', bind: 'entry.lastName', value: e.lastName, required: true, invalid: ctx.invalid('Last name'), autocomplete: 'off' })}
        ${field({ id: 'dob', label: 'Date of birth', type: 'date', bind: 'entry.dob', value: e.dob, required: true, invalid: ctx.invalid('Date of birth', 'dob'), extra: { max: localIsoDate(new Date()), min: '1900-01-01' }, hint: 'Checked against the watchlist with the name.' })}
        ${s.type === 'contractor' ? field({ id: 'company', label: 'Company', bind: 'entry.company', value: e.company, required: true, invalid: ctx.invalid('Company'), autocomplete: 'organization' }) : ''}
      </div>
      ${destinationField(ctx)}
      ${submitRow()}
    </form>
  </section>`;
}

function duplicatesSection(ctx) {
  const s = ctx.state;
  return html`<section class="panel step panel-attention" aria-labelledby="dup-title">
    <p class="eyebrow">Check before continuing</p>
    <h2 id="dup-title">${s.duplicates.length === 1 ? 'A record' : 'Records'} with this name and date of birth already ${s.duplicates.length === 1 ? 'exists' : 'exist'}</h2>
    <p>Stronghold never reuses or merges a record unless you choose to. Use the existing record if this is the same person, or create a new record if it is someone else.</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Date of birth</th><th scope="col">Company</th><th scope="col">Visits</th><th scope="col">Status</th><th scope="col"><span class="sr">Action</span></th></tr></thead>
      <tbody>${s.duplicates.map(
        (r) => html`<tr>
          <td data-label="Name"><a class="name-link" href="#/people/${r.id}">${r.lastName}, ${r.firstName}</a></td>
          <td data-label="Type">${typeTag(r.type)}</td>
          <td data-label="Date of birth" class="num">${fmt.dob(r.dob)}</td>
          <td data-label="Company">${r.company || ''}</td>
          <td data-label="Visits" class="num">${r.visitCount}</td>
          <td data-label="Status">${statusCell(r)}</td>
          <td class="col-action">${button({ label: 'Use This Record', action: 'use-existing', data: { person: r.id }, kind: 'primary', small: true, why: r.status === 'in' ? 'Already signed in.' : r.status === 'held' ? 'A sign-in is waiting for a decision.' : null })}</td>
        </tr>`,
      )}</tbody>
    </table></div>
    <div class="form-actions">
      ${button({ label: 'Create a New Record', action: 'create-new', id: 'create-new' })}
      ${button({ label: 'Back to the Form', action: 'back-to-form', kind: 'ghost', id: 'back-to-form' })}
    </div>
  </section>`;
}

function screenedSection(ctx) {
  const s = ctx.state;
  return html`<section class="result result-pending" aria-live="polite">
    <div class="result-head"><span class="stamp">Screening result</span>${screeningPill(s.screening.outcome)}</div>
    <p>${s.screening.outcome === 'no match' ? 'No match on the watchlist. Recording the sign-in.' : 'Holding the sign-in for a decision.'}</p>
  </section>`;
}

function sidePanel(ctx) {
  const stats = ctx.svc.stats(ctx.user.id);
  const showTries = ctx.svc.hasSampleData() && !prefs.get('hideTries', false);
  return html`<aside class="desk-side" aria-label="At the desk">
    <section class="panel panel-quiet now">
      <h2>In the building now</h2>
      <p class="big-number"><a href="#/present">${stats.present}</a></p>
      <p>${stats.present === 1 ? 'person is' : 'people are'} signed in. <a href="#/present">Currently Signed In</a></p>
      ${stats.held ? html`<p class="held-note">${icon('pause')} <a href="#/held">${fmt.count(stats.held, 'sign-in')} held</a> for a decision.</p>` : ''}
    </section>
    ${
      showTries
        ? html`<section class="panel panel-quiet tries">
            <h2>Things to try</h2>
            <p class="hint">These use the example records added at setup.</p>
            <ul>${SAMPLE_TRIES.map((t) => html`<li><strong>${t.label}.</strong> ${t.detail}</li>`)}</ul>
            ${button({ label: 'Hide Suggestions', action: 'hide-tries', kind: 'ghost', small: true })}
          </section>`
        : ''
    }
  </aside>`;
}

export const signInPage = {
  id: 'sign-in',
  name: 'Sign In',
  // Following a name link to check a record and coming back keeps what was typed.
  keepState: true,
  restore(ctx, kept) {
    if (ctx.params.id || kept.step === 'screened') return false;
    if (kept.step === 'held' && !ctx.svc.listHolds(ctx.user.id).some((h) => h.id === kept.hold.id)) return false;
    return true;
  },
  title: () => 'Sign In',
  lede: () => 'Find a returning person or enter a new one, then submit. Screening runs before anyone is signed in.',

  init(ctx) {
    const s = fresh();
    if (ctx.params.id) {
      try {
        const { person } = ctx.svc.getPerson(ctx.user.id, ctx.params.id);
        s.type = person.type;
        s.mode = 'returning';
        s.step = 'returning';
        s.personId = person.id;
      } catch {
        /* the record is gone; start from search */
      }
    }
    return s;
  },

  view(ctx) {
    const s = ctx.state;
    let main;
    switch (s.step) {
      case 'returning':
        main = returningSection(ctx);
        break;
      case 'manual':
        main = html`${searchSection(ctx)}${manualSection(ctx)}`;
        break;
      case 'duplicates':
        main = duplicatesSection(ctx);
        break;
      case 'screened':
        main = screenedSection(ctx);
        break;
      case 'held':
        main = html`${holdPanel(ctx, s.hold)}<div class="form-actions">${button({ label: 'Leave Held and Sign In Another Person', action: 'reset', kind: 'ghost', id: 'leave-held' })}</div>
          <p class="hint">A held sign-in stays on Held Sign-Ins until someone decides.</p>`;
        break;
      case 'done':
        main = admittedPanel(ctx, s.outcome);
        break;
      case 'refused':
        main = refusedPanel(s.outcome);
        break;
      default:
        main = searchSection(ctx);
    }
    return html`<div class="desk">${html`<div class="desk-main">${main}</div>`}${sidePanel(ctx)}</div>`;
  },

  actions: {
    find(ctx) {
      const s = ctx.state;
      const q = s.query.trim();
      if (!q) {
        ctx.error = { message: 'Fill in the required detail: Name.', missing: ['Name'], scope: 'find' };
        ctx.focusError = true;
        ctx.render();
        return;
      }
      s.searched = q;
      s.step = 'search';
      ctx.render();
    },

    'switch-type'(ctx, el) {
      ctx.state.type = el.dataset.type;
      ctx.render();
    },

    select(ctx, el) {
      const s = ctx.state;
      s.personId = el.dataset.person;
      s.mode = 'returning';
      s.step = 'returning';
      ctx.focusAfter = '#destination';
      ctx.render();
    },

    manual(ctx) {
      const s = ctx.state;
      if (!s.entry.firstName && !s.entry.lastName && s.query.trim()) {
        const parts = s.query.trim().split(/\s+/);
        if (parts.length === 1) s.entry.lastName = parts[0];
        else {
          s.entry.firstName = parts[0];
          s.entry.lastName = parts.slice(1).join(' ');
        }
      }
      s.mode = 'manual';
      s.step = 'manual';
      s.confirmNew = false;
      ctx.focusAfter = s.entry.firstName ? '#dob' : '#firstName';
      ctx.render();
    },

    cancel(ctx) {
      const s = ctx.state;
      const type = s.type;
      Object.assign(s, fresh(type), { query: s.query, searched: s.searched });
      ctx.say('info', 'Cancelled. Nobody was signed in.');
      ctx.focusAfter = '#query';
      ctx.render();
    },

    async submit(ctx, form, event) {
      const s = ctx.state;
      const submitter = (event && event.submitter) || document.activeElement;
      s.print = !(submitter && submitter.dataset && submitter.dataset.intent === 'submit');
      if (s.mode === 'manual') s.confirmNew = false;
      await screenAndCommit(ctx);
    },

    async 'use-existing'(ctx, el) {
      const s = ctx.state;
      s.personId = el.dataset.person;
      s.mode = 'returning';
      await screenAndCommit(ctx);
    },

    async 'create-new'(ctx) {
      ctx.state.confirmNew = true;
      ctx.state.mode = 'manual';
      await screenAndCommit(ctx);
    },

    'back-to-form'(ctx) {
      ctx.state.step = 'manual';
      ctx.render();
    },

    async decide(ctx, form, event) {
      const s = ctx.state;
      const result = await decideFromForm(ctx, form, event);
      if (result.decision === 'refuse') {
        s.outcome = { name: `${result.hold.person.firstName} ${result.hold.person.lastName}`, screening: result.hold.screening, next: nextButton() };
        s.step = 'refused';
        ctx.render();
        return;
      }
      s.step = 'done';
      await showAdmitted(ctx, result, (o) => (s.outcome = { ...o, next: nextButton() }));
    },

    async 'print-badge'(ctx, el) {
      const s = ctx.state;
      const r = await printBadge(ctx.svc, ctx.user.id, el.dataset.visit);
      if (s.outcome) s.outcome.printResult = r;
      ctx.render();
    },

    reset(ctx) {
      ctx.state = fresh(ctx.state.type);
      ctx.focusAfter = '#query';
      ctx.render();
    },

    'hide-tries'(ctx) {
      prefs.set('hideTries', true);
      ctx.render();
    },
  },
};
