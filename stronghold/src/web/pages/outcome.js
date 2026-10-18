// Panels shared by Sign In and Held Sign-Ins: a held sign-in with its decision form, a person
// signed in with their badge, and a refusal.
import { html, fmt, icon, screeningPill, typeTag, textareaField, requiredLegend, button, alertBox, SCREENING_LABELS } from '../ui.js';
import { badgeMarkup } from '../badge.js';
import { printBadge, afterPaint } from '../print.js';

const TONES = { match: 'bad', 'possible match': 'warn', 'not run': 'muted' };

// REQ_000_019: why the sign-in is held, and each matching entry. REQ_000_020: any user decides.
export function holdPanel(ctx, hold) {
  const p = hold.person;
  const reasonId = `reason-${hold.id}`;
  return html`<section class="hold hold-${TONES[hold.screening] || 'warn'}" aria-labelledby="hold-${hold.id}">
    <div class="result-head">
      <span class="stamp">${icon('pause')}<span>Sign-in held</span></span>
      ${screeningPill(hold.screening)}
    </div>
    <h2 id="hold-${hold.id}">${p.firstName} ${p.lastName}</h2>
    <p class="hold-reason">${hold.reason}</p>
    <dl class="facts">
      <div><dt>Date of birth</dt><dd>${fmt.dob(p.dob)}</dd></div>
      <div><dt>Person type</dt><dd>${typeTag(p.type)}${p.company ? html` ${p.company}` : ''}</dd></div>
      <div><dt>Destination</dt><dd>${hold.destination}</dd></div>
      <div><dt>Held</dt><dd>${fmt.when(hold.createdAt)} by ${hold.createdBy.name}</dd></div>
      <div><dt>Record</dt><dd>${hold.personId ? html`<a href="#/people/${hold.personId}">Open record and visit history</a>` : 'New entry. A record is created only if the person is admitted.'}</dd></div>
    </dl>
    ${
      hold.matches.length
        ? html`<h3>Matching watchlist ${hold.matches.length === 1 ? 'entry' : 'entries'}</h3>
          <div class="table-wrap"><table class="table table-compact">
            <thead><tr><th scope="col">Name on the watchlist</th><th scope="col">Date of birth</th><th scope="col">Date of birth matches</th></tr></thead>
            <tbody>${hold.matches.map((m) => html`<tr><td>${m.lastName}, ${m.firstName}</td><td>${fmt.dob(m.dob)}</td><td>${m.dobMatches ? html`<strong class="text-bad">Yes</strong>` : 'No'}</td></tr>`)}</tbody>
          </table></div>`
        : html`<p class="muted">No watchlist entries were compared, because screening did not run.</p>`
    }
    <form class="decision" data-action="decide" data-hold="${hold.id}" data-scope="decide" novalidate>
      <h3>Decision</h3>
      <p class="hint">Any logged-in user can admit or refuse. The Audit Log keeps the decision, the reason, who decided and when, the screening result and the matching entries.</p>
      ${ctx.errorFor('decide')}
      ${requiredLegend()}
      ${textareaField({ id: reasonId, label: 'Reason', bind: `reasons.${hold.id}`, value: (ctx.state.reasons || {})[hold.id] || '', required: true, invalid: ctx.invalid('Reason'), hint: 'For example: ID checked, the date of birth differs from the watchlist entry.' })}
      <div class="form-actions">
        <button type="submit" name="decision" value="admit" class="btn btn-primary" data-decision="admit">${icon('check')}<span>${hold.print ? 'Admit and Print Badge' : 'Admit'}</span></button>
        <button type="submit" name="decision" value="refuse" class="btn btn-danger" data-decision="refuse"><span>Refuse</span></button>
      </div>
    </form>
  </section>`;
}

// Runs the decision for the hold whose form was submitted. Returns the service's result.
export async function decideFromForm(ctx, form, event) {
  const holdId = form.dataset.hold;
  const submitter = (event && event.submitter) || document.activeElement;
  const decision = submitter && submitter.dataset ? submitter.dataset.decision : null;
  const reason = (ctx.state.reasons || {})[holdId] || '';
  const hold = ctx.svc.getHold(ctx.user.id, holdId);
  const result = await ctx.svc.decideHold(ctx.user.id, holdId, { decision, reason });
  return { ...result, hold };
}

export function admittedPanel(ctx, outcome) {
  const { person, visit, decision, printResult } = outcome;
  let badge = null;
  let badgeWhy = null;
  try {
    badge = ctx.svc.badge(ctx.user.id, visit.id);
  } catch (e) {
    badgeWhy = e.message;
  }
  const how =
    visit.screening === 'no match'
      ? 'Screening found no match.'
      : `Admitted by ${decision ? decision.by : 'a user'} after the screening result “${SCREENING_LABELS[visit.screening]}”.`;
  return html`<section class="result result-ok" aria-labelledby="done-title">
    <div class="result-head">
      <span class="stamp stamp-ok">${icon('check')}<span>Signed in</span></span>
      ${screeningPill(visit.screening)}
    </div>
    <h2 id="done-title">${person.firstName} ${person.lastName}</h2>
    <p>${how} Signed in ${fmt.whenInline(visit.signInAt)} to ${visit.destination}. Visit ${fmt.visitNo(visit.number)}.</p>
    ${printResult ? alertBox(printResult.ok ? 'ok' : 'warn', printResult.text) : ''}
    <div class="done-grid">
      ${badge ? html`<div class="badge-preview">${badgeMarkup(badge)}</div>` : ''}
      <div class="form-actions form-actions-stack">
        ${button({ label: 'Print Badge', action: 'print-badge', data: { visit: visit.id }, iconName: 'print', why: badgeWhy, id: 'print-done' })}
        <a class="btn btn-secondary" href="#/people/${person.id}">Open Record</a>
        ${outcome.next || ''}
      </div>
    </div>
  </section>`;
}

export function refusedPanel(outcome) {
  return html`<section class="result result-bad" aria-labelledby="refused-title">
    <div class="result-head"><span class="stamp stamp-bad">${icon('alert')}<span>Refused</span></span>${screeningPill(outcome.screening)}</div>
    <h2 id="refused-title">${outcome.name}</h2>
    <p>The sign-in was refused and no visit was recorded. The decision and its reason are in the Audit Log.</p>
    ${outcome.next || ''}
  </section>`;
}

// After an admit: show the person signed in, then print if the sign-in asked for a badge.
// `store(outcome)` keeps the outcome in the page state and returns the object it kept.
export async function showAdmitted(ctx, result, store) {
  const kept = store({ person: result.person, visit: result.visit, decision: { by: ctx.user.displayName } });
  ctx.focusAfter = '#done-title';
  ctx.render();
  if (!result.print) return;
  if (!ctx.user.roles.includes('operator')) {
    kept.printResult = { ok: false, text: 'No badge was printed, because printing badges is for Operator accounts. An Operator can print it from Currently Signed In.' };
  } else {
    kept.printResult = await afterPaint(() => printBadge(ctx.svc, ctx.user.id, result.visit.id));
  }
  ctx.render();
}

export { printBadge };
