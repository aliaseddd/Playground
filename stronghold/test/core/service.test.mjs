import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Service, UserError } from '../../src/core/service.js';
import { MemoryStore } from '../../src/core/memory-store.js';
import { APP_VERSION } from '../../src/core/version.js';
import { nameMatches, screenPerson } from '../../src/core/screening.js';
import { toCsv } from '../../src/core/text.js';

// A clock the tests move by hand.
function clock(start = '2026-10-12T14:00:00') {
  let t = new Date(start);
  return {
    now: () => new Date(t.getTime()),
    advance: (minutes) => {
      t = new Date(t.getTime() + minutes * 60000);
    },
    set: (iso) => {
      t = new Date(iso);
    },
  };
}

async function fresh({ sampleData = false } = {}) {
  const c = clock();
  const store = new MemoryStore();
  const svc = await Service.open(store, { now: c.now, iterations: 1000 });
  const admin = await svc.setUp({ siteName: 'Riverside Civic Center', displayName: 'Dana Admin', username: 'dana', password: 'correct horse', confirm: 'correct horse', sampleData });
  return { svc, store, c, admin };
}

async function rejects(promiseOrFn, check) {
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (e) {
    assert.ok(e instanceof UserError, `expected UserError, got ${e}`);
    if (check) check(e);
    return e;
  }
  assert.fail('expected a UserError');
}

async function signIn(svc, userId, input) {
  const screened = svc.screenSignIn(userId, input);
  if (screened.status !== 'screened') return screened;
  return svc.commitSignIn(userId, input, screened.screening.outcome);
}

const ana = { type: 'visitor', firstName: 'Ana', lastName: 'Lopez', dob: '1988-04-12' };

describe('setup and login', () => {
  test('the first account gets both roles and setup cannot run twice', async () => {
    const { svc, admin } = await fresh();
    assert.deepEqual(admin.roles, ['operator', 'admin']);
    assert.equal(admin.password, undefined);
    await rejects(svc.setUp({ siteName: 'x', displayName: 'y', username: 'zz', password: '12345678', confirm: '12345678' }), (e) => assert.equal(e.code, 'state'));
  });

  test('setup names every missing detail', async () => {
    const svc = await Service.open(new MemoryStore(), { iterations: 1000 });
    await rejects(svc.setUp({ siteName: ' ', displayName: '', username: 'ok' }), (e) => {
      assert.deepEqual(e.missing, ['Building name', 'Your name', 'Password', 'Confirm password']);
      assert.match(e.message, /Building name, Your name, Password, Confirm password/);
    });
  });

  test('login checks the password and refuses disabled accounts', async () => {
    const { svc, admin } = await fresh();
    await rejects(svc.logIn('dana', 'wrong password'), (e) => assert.equal(e.code, 'auth'));
    const ok = await svc.logIn('DANA', 'correct horse');
    assert.equal(ok.id, admin.id);
    const op = await svc.addUser(admin.id, { displayName: 'Desk One', username: 'desk1', roles: ['operator'], password: 'desk password', confirm: 'desk password' });
    await svc.setUserDisabled(admin.id, op.id, true);
    await rejects(svc.logIn('desk1', 'desk password'), (e) => assert.match(e.message, /disabled/));
    assert.equal(svc.sessionUser(op.id), null);
  });

  test('the last active Administrator cannot be disabled or lose the role, and nobody disables themselves', async () => {
    const { svc, admin } = await fresh();
    assert.match(svc.whyCannotDisable(admin.id, admin.id), /logged in with/);
    const other = await svc.addUser(admin.id, { displayName: 'Op', username: 'op', roles: ['operator'], password: 'op password', confirm: 'op password' });
    await rejects(svc.changeUser(admin.id, admin.id, { displayName: 'Dana Admin', roles: ['operator'] }), (e) => assert.match(e.message, /only active Administrator/));
    assert.equal(svc.whyCannotDisable(admin.id, other.id), null);
  });
});

describe('sign-in, screening and holds', () => {
  let svc, admin, c;
  beforeEach(async () => {
    ({ svc, admin, c } = await fresh());
    await svc.addDestination(admin.id, 'Main Office');
  });
  const dest = () => svc.listDestinations(admin.id)[0].id;

  test('a new visitor with no match is screened, signed in and listed (REQ_000_002, 007, 009, 011, 016, 018)', async () => {
    const input = { person: ana, destinationMode: 'list', destinationId: dest(), print: true };
    const screened = svc.screenSignIn(admin.id, input);
    assert.equal(screened.status, 'screened');
    assert.equal(screened.screening.outcome, 'no match');
    assert.equal(svc.presentList(admin.id).length, 0, 'screening alone records nothing');
    const result = await svc.commitSignIn(admin.id, input, 'no match');
    assert.equal(result.status, 'signed-in');
    const { visit, person } = result;
    assert.equal(visit.destination, 'Main Office');
    assert.equal(visit.signInAt, c.now().toISOString());
    assert.equal(visit.signedInBy.id, admin.id);
    assert.equal(visit.screening, 'no match');
    assert.equal(visit.number, 1);
    assert.deepEqual([person.firstName, person.lastName, person.dob, person.type], ['Ana', 'Lopez', '1988-04-12', 'visitor']);
    assert.deepEqual(svc.presentList(admin.id).map((r) => r.person.id), [person.id]);
  });

  test('a returning person is found by name and signed in without re-entry (REQ_000_001)', async () => {
    const first = await signIn(svc, admin.id, { person: ana, destinationMode: 'list', destinationId: dest() });
    await svc.signOut(admin.id, [first.visit.id]);
    const found = svc.findPeople(admin.id, { query: 'lop', type: 'visitor' });
    assert.equal(found.results.length, 1);
    const again = await signIn(svc, admin.id, { personId: found.results[0].id, destinationMode: 'typed', destinationText: 'Mayor’s office' });
    assert.equal(again.status, 'signed-in');
    assert.equal(again.person.id, first.person.id);
    assert.equal(again.visit.destination, 'Mayor’s office');
    assert.equal(again.visit.destinationSource, 'typed');
    assert.equal(svc.listDestinations(admin.id).length, 1, 'a typed destination is for this visit only');
  });

  test('search counts people of the other type instead of hiding them', async () => {
    await signIn(svc, admin.id, { person: ana, destinationMode: 'list', destinationId: dest() });
    const found = svc.findPeople(admin.id, { query: 'Ana', type: 'contractor' });
    assert.equal(found.results.length, 0);
    assert.deepEqual(found.otherTypes, { visitor: 1 });
  });

  test('missing details are named in form order and stop the sign-in (REQ_000_050)', async () => {
    await rejects(() => svc.screenSignIn(admin.id, { person: { type: 'contractor', firstName: 'Sam' }, destinationMode: 'list' }), (e) => {
      assert.deepEqual(e.missing, ['Last name', 'Date of birth', 'Company', 'Destination']);
    });
    assert.equal(svc.presentList(admin.id).length, 0);
  });

  test('a contractor keeps their company (REQ_000_004)', async () => {
    const r = await signIn(svc, admin.id, { person: { type: 'contractor', firstName: 'Sam', lastName: 'Okafor', dob: '1986-09-23', company: 'Brightline' }, destinationMode: 'list', destinationId: dest() });
    assert.equal(r.person.company, 'Brightline');
    const visitor = await signIn(svc, admin.id, { person: { ...ana, company: 'ignored' }, destinationMode: 'list', destinationId: dest() });
    assert.equal(visitor.person.company, null);
  });

  test('a person already signed in cannot be signed in again (REQ_000_010)', async () => {
    const r = await signIn(svc, admin.id, { person: ana, destinationMode: 'list', destinationId: dest() });
    await rejects(() => svc.screenSignIn(admin.id, { personId: r.person.id, destinationMode: 'list', destinationId: dest() }), (e) => assert.equal(e.code, 'signed-in'));
    await rejects(svc.commitSignIn(admin.id, { personId: r.person.id, destinationMode: 'list', destinationId: dest() }, 'no match'), (e) => assert.equal(e.code, 'signed-in'));
  });

  test('an entry matching an existing record offers the record and never reuses it silently (REQ_000_027)', async () => {
    const r = await signIn(svc, admin.id, { person: ana, destinationMode: 'list', destinationId: dest() });
    await svc.signOut(admin.id, [r.visit.id]);
    const again = svc.screenSignIn(admin.id, { person: { ...ana, firstName: 'ANA ' }, destinationMode: 'list', destinationId: dest() });
    assert.equal(again.status, 'duplicates');
    assert.equal(again.candidates[0].id, r.person.id);
    const asNew = await signIn(svc, admin.id, { person: ana, confirmNew: true, destinationMode: 'list', destinationId: dest() });
    assert.notEqual(asNew.person.id, r.person.id);
    assert.equal(svc.listPeople(admin.id).length, 2);
  });

  test('a name and date of birth match holds the sign-in, says why and shows the entry (REQ_000_014, 019)', async () => {
    await svc.addWatchlistEntry(admin.id, { firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' });
    const input = { person: { type: 'visitor', firstName: 'marcus', lastName: 'REED', dob: '1985-07-22' }, destinationMode: 'list', destinationId: dest(), print: true };
    const screened = svc.screenSignIn(admin.id, input);
    assert.equal(screened.screening.outcome, 'match');
    assert.match(screened.screening.reason, /name and date of birth match/);
    const held = await svc.commitSignIn(admin.id, input, 'match');
    assert.equal(held.status, 'held');
    assert.equal(held.hold.matches.length, 1);
    assert.equal(held.hold.matches[0].dobMatches, true);
    assert.equal(svc.presentList(admin.id).length, 0, 'no visit until someone admits');
    assert.equal(svc.listPeople(admin.id).length, 0, 'no person record for a held new entry');
    await rejects(() => svc.screenSignIn(admin.id, input), (e) => assert.equal(e.code, 'held'));
  });

  test('a name-only match is a possible match (REQ_000_015)', async () => {
    await svc.addWatchlistEntry(admin.id, { firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' });
    const s = svc.screenSignIn(admin.id, { person: { type: 'visitor', firstName: 'Marcus', lastName: 'Reed', dob: '1991-05-02' }, destinationMode: 'list', destinationId: dest() });
    assert.equal(s.screening.outcome, 'possible match');
    assert.equal(s.screening.matches[0].dobMatches, false);
  });

  test('screening switched off gives "not run" and holds (REQ_000_013)', async () => {
    await svc.updateSettings(admin.id, { siteName: 'Riverside Civic Center', retentionDays: '365', watchlistAvailable: false });
    const s = svc.screenSignIn(admin.id, { person: ana, destinationMode: 'list', destinationId: dest() });
    assert.equal(s.screening.outcome, 'not run');
    assert.match(s.screening.reason, /switched watchlist screening off/);
  });

  test('the result shown is the result acted on: an edited watchlist forces a fresh result first (REQ_000_017)', async () => {
    const input = { person: { type: 'visitor', firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' }, destinationMode: 'list', destinationId: dest() };
    const s = svc.screenSignIn(admin.id, input);
    assert.equal(s.screening.outcome, 'no match');
    await svc.addWatchlistEntry(admin.id, { firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' });
    const r = await svc.commitSignIn(admin.id, input, s.screening.outcome);
    assert.equal(r.status, 'rescreened');
    assert.equal(r.screening.outcome, 'match');
    assert.equal(svc.presentList(admin.id).length, 0);
  });

  test('any user may admit or refuse, with a reason, and the decision is logged in full (REQ_000_020, 021)', async () => {
    await svc.addWatchlistEntry(admin.id, { firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' });
    const adminOnly = await svc.addUser(admin.id, { displayName: 'Sec Lead', username: 'lead', roles: ['admin'], password: 'lead password', confirm: 'lead password' });
    const input = { person: { type: 'visitor', firstName: 'Marcus', lastName: 'Reed', dob: '1991-05-02' }, destinationMode: 'list', destinationId: dest(), print: true };
    const held = await signIn(svc, admin.id, input);
    await rejects(svc.decideHold(adminOnly.id, held.hold.id, { decision: 'admit', reason: ' ' }), (e) => assert.deepEqual(e.missing, ['Reason']));
    c.advance(3);
    const d = await svc.decideHold(adminOnly.id, held.hold.id, { decision: 'admit', reason: 'Different date of birth; ID checked.' });
    assert.equal(d.print, true);
    assert.equal(d.visit.screening, 'possible match');
    assert.ok(d.visit.decisionId);
    const entry = svc.auditLog(admin.id).find((a) => a.kind === 'decision');
    assert.equal(entry.actor.id, adminOnly.id);
    assert.equal(entry.at, c.now().toISOString());
    assert.equal(entry.data.decision, 'admit');
    assert.equal(entry.data.reason, 'Different date of birth; ID checked.');
    assert.equal(entry.data.screening, 'possible match');
    assert.deepEqual([entry.data.person.firstName, entry.data.person.lastName, entry.data.person.dob], ['Marcus', 'Reed', '1991-05-02']);
    assert.equal(entry.data.matches[0].dob, '1985-07-22');
    assert.equal(svc.listHolds(admin.id).length, 0);
  });

  test('a refusal records no visit and no person', async () => {
    await svc.addWatchlistEntry(admin.id, { firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' });
    const held = await signIn(svc, admin.id, { person: { type: 'visitor', firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' }, destinationMode: 'list', destinationId: dest() });
    await svc.decideHold(admin.id, held.hold.id, { decision: 'refuse', reason: 'Trespass order on file.' });
    assert.equal(svc.listPeople(admin.id).length, 0);
    assert.equal(svc.presentList(admin.id).length, 0);
    await rejects(svc.decideHold(admin.id, held.hold.id, { decision: 'admit', reason: 'again' }), (e) => assert.equal(e.code, 'not-found'));
  });

  test('sign-out records time and operator, and the badge stops (REQ_000_008, 023, CON_000_004)', async () => {
    const r = await signIn(svc, admin.id, { person: ana, destinationMode: 'list', destinationId: dest() });
    const badge = svc.badge(admin.id, r.visit.id);
    assert.equal(badge.siteName, 'Riverside Civic Center');
    assert.equal('screening' in badge, false);
    assert.equal('dob' in badge, false);
    c.advance(45);
    const out = await svc.signOut(admin.id, [r.visit.id]);
    assert.equal(out.signedOut[0].visit.signOutAt, c.now().toISOString());
    assert.equal(out.signedOut[0].visit.signedOutBy.id, admin.id);
    assert.equal(svc.presentList(admin.id).length, 0);
    assert.throws(() => svc.badge(admin.id, r.visit.id), (e) => e.code === 'no-open-visit');
    const again = await svc.signOut(admin.id, [r.visit.id]);
    assert.equal(again.skipped.length, 1);
  });

  test('a failed write leaves nothing half done', async () => {
    const { svc: s, store, admin: a } = await fresh();
    await s.addDestination(a.id, 'Main Office');
    const input = { person: ana, destinationMode: 'list', destinationId: s.listDestinations(a.id)[0].id };
    store.failNextCommit = new Error('disk full');
    await assert.rejects(signIn(s, a.id, input), /disk full/);
    assert.equal(s.listPeople(a.id).length, 0);
    assert.equal(s.presentList(a.id).length, 0);
    const reopened = await Service.open(store, { iterations: 1000 });
    assert.equal(reopened.listPeople(a.id).length, 0);
  });

  test('records survive reopening the store (REQ_000_040)', async () => {
    const { svc: s, store, admin: a } = await fresh();
    await s.addDestination(a.id, 'Main Office');
    await signIn(s, a.id, { person: ana, destinationMode: 'list', destinationId: s.listDestinations(a.id)[0].id });
    const reopened = await Service.open(store, { iterations: 1000 });
    assert.equal(reopened.presentList(a.id).length, 1);
    assert.equal(reopened.presentList(a.id)[0].visit.number, 1);
  });
});

describe('corrections, report and roles', () => {
  test('a correction needs a reason, is logged, and cannot remove a sign-out (REQ_000_035)', async () => {
    const { svc, admin, c } = await fresh();
    await svc.addDestination(admin.id, 'Main Office');
    const r = await signIn(svc, admin.id, { person: ana, destinationMode: 'list', destinationId: svc.listDestinations(admin.id)[0].id });
    c.advance(60);
    await svc.signOut(admin.id, [r.visit.id]);
    const v = svc.getPerson(admin.id, r.person.id).visits[0];
    await rejects(svc.correctVisit(admin.id, v.id, { signInAt: v.signInAt, signOutAt: v.signOutAt, destination: 'Records Room' }, ''), (e) => assert.deepEqual(e.missing, ['Reason for the change']));
    await rejects(svc.correctVisit(admin.id, v.id, { signInAt: v.signInAt, signOutAt: '', destination: v.destination }, 'oops'), (e) => assert.match(e.message, /moved but not removed/));
    const earlier = new Date(new Date(v.signOutAt).getTime() - 15 * 60000).toISOString();
    await svc.correctVisit(admin.id, v.id, { signInAt: v.signInAt, signOutAt: earlier, destination: 'Records Room' }, 'Left at 14:45; went to Records.');
    const after = svc.getPerson(admin.id, r.person.id).visits[0];
    assert.equal(after.signOutAt, earlier);
    assert.equal(after.corrections, 1);
    const log = svc.auditLog(admin.id).find((a) => a.kind === 'visit-correction');
    assert.deepEqual(Object.keys(log.data.after).sort(), ['destination', 'signOutAt']);
    assert.equal(log.data.reason, 'Left at 14:45; went to Records.');
  });

  test('the report holds exactly the visits signed in within the local date range (REQ_000_026)', async () => {
    const { svc, admin, c } = await fresh();
    await svc.addDestination(admin.id, 'Main Office');
    const d = svc.listDestinations(admin.id)[0].id;
    c.set('2026-10-10T23:30:00');
    const a = await signIn(svc, admin.id, { person: ana, destinationMode: 'list', destinationId: d });
    c.set('2026-10-11T00:10:00');
    await svc.signOut(admin.id, [a.visit.id]);
    const b = await signIn(svc, admin.id, { person: { type: 'visitor', firstName: 'Bo', lastName: 'Li', dob: '1990-01-01' }, destinationMode: 'list', destinationId: d });
    c.set('2026-10-12T09:00:00');
    assert.deepEqual(svc.report(admin.id, { from: '2026-10-10', to: '2026-10-10' }).rows.map((r) => r.visit.id), [a.visit.id]);
    assert.deepEqual(svc.report(admin.id, { from: '2026-10-11', to: '2026-10-12' }).rows.map((r) => r.visit.id), [b.visit.id]);
    assert.equal(svc.report(admin.id, { from: '2026-10-01', to: '2026-10-31' }).rows.length, 2);
    await rejects(() => svc.report(admin.id, { from: '2026-10-12', to: '2026-10-01' }), (e) => assert.match(e.message, /on or before/));
  });

  test('only Administrators change destinations, watchlist, accounts and settings (REQ_000_034)', async () => {
    const { svc, admin } = await fresh();
    const op = await svc.addUser(admin.id, { displayName: 'Desk', username: 'desk', roles: ['operator'], password: 'desk password', confirm: 'desk password' });
    const forbidden = (e) => assert.equal(e.code, 'forbidden');
    await rejects(svc.addDestination(op.id, 'Gym'), forbidden);
    await rejects(svc.addWatchlistEntry(op.id, { firstName: 'A', lastName: 'B', dob: '1990-01-01' }), forbidden);
    await rejects(svc.addUser(op.id, { displayName: 'x', username: 'xx', roles: ['admin'], password: '12345678', confirm: '12345678' }), forbidden);
    await rejects(svc.updateSettings(op.id, { siteName: 'x', retentionDays: '1', watchlistAvailable: true }), forbidden);
    await rejects(() => svc.listWatchlist(op.id), forbidden);
    await rejects(() => svc.auditLog(op.id), forbidden);
  });

  test('removals and deletions are logged with kind, identifier, who, when and why (REQ_000_036)', async () => {
    const { svc, admin } = await fresh();
    const d = await svc.addDestination(admin.id, 'Gym');
    await svc.removeDestination(admin.id, d.id, 'Closed for renovation');
    const w = await svc.addWatchlistEntry(admin.id, { firstName: 'A', lastName: 'B', dob: '1990-01-01' });
    await svc.removeWatchlistEntry(admin.id, w.id, 'Order expired');
    const deletions = svc.auditLog(admin.id).filter((a) => a.kind === 'deletion');
    assert.deepEqual(deletions.map((a) => [a.data.recordKind, a.data.recordId, a.data.reason]), [
      ['watchlist entry', w.id, 'Order expired'],
      ['destination', d.id, 'Closed for renovation'],
    ]);
    assert.ok(deletions.every((a) => a.actor.id === admin.id && a.at));
  });

  test('destination names stay unique', async () => {
    const { svc, admin } = await fresh();
    await svc.addDestination(admin.id, 'Main Office');
    await rejects(svc.addDestination(admin.id, ' main  office '), (e) => assert.match(e.message, /already has a destination/));
  });
});

describe('retention, backup and example data', () => {
  test('only visits past the retention period can be deleted, and orphaned people can go with them (REQ_000_038, 039)', async () => {
    const { svc, admin } = await fresh({ sampleData: true });
    const expired = svc.expiredVisits(admin.id);
    assert.equal(expired.length, 4);
    const recent = svc.report(admin.id, { from: '2026-10-01', to: '2026-10-12' }).rows[0].visit;
    await rejects(svc.deleteExpiredVisits(admin.id, [recent.id], 'tidy'), (e) => assert.match(e.message, /has not passed the retention period/));
    const peopleBefore = svc.listPeople(admin.id).length;
    const result = await svc.deleteExpiredVisits(admin.id, expired.map((r) => r.visit.id), 'Annual retention review', { deleteOrphans: true });
    assert.deepEqual(result, { visits: 4, people: 2 });
    assert.equal(svc.listPeople(admin.id).length, peopleBefore - 2);
    assert.equal(svc.expiredVisits(admin.id).length, 0);
  });

  test('the retention period is set by an Administrator, validated, and moves the expiry line (REQ_000_031)', async () => {
    const { svc, admin } = await fresh({ sampleData: true });
    const settings = (days) => ({ siteName: 'Riverside Civic Center', retentionDays: days, watchlistAvailable: true });
    await rejects(svc.updateSettings(admin.id, settings('0')), (e) => assert.equal(e.field, 'retentionDays'));
    await rejects(svc.updateSettings(admin.id, settings('30.5')), (e) => assert.equal(e.field, 'retentionDays'));
    assert.equal(svc.expiredVisits(admin.id).length, 4);
    await svc.updateSettings(admin.id, settings('3'));
    assert.equal(svc.settings().retentionDays, 3);
    assert.ok(svc.expiredVisits(admin.id).length > 4);
    const log = svc.auditLog(admin.id)[0];
    assert.equal(log.kind, 'settings');
    assert.deepEqual([log.data.before.retentionDays, log.data.after.retentionDays], [365, 3]);
  });

  test('example data gives a working desk: people present, a watchlist and history', async () => {
    const { svc, admin } = await fresh({ sampleData: true });
    assert.equal(svc.presentList(admin.id).length, 3);
    assert.equal(svc.listWatchlist(admin.id).length, 4);
    assert.ok(svc.listPeople(admin.id).length >= 13);
    assert.ok(svc.auditLog(admin.id).some((a) => a.kind === 'decision'));
    assert.ok(svc.hasSampleData());
  });

  test('a person with visits cannot be deleted; one without can, and the deletion is logged', async () => {
    const { svc, admin } = await fresh({ sampleData: true });
    const someone = svc.listPeople(admin.id)[0];
    assert.match(svc.whyCannotDeletePerson(someone.id), /retention period/);
    await rejects(svc.deletePerson(admin.id, someone.id, 'x'), (e) => assert.equal(e.code, 'forbidden'));
  });

  test('example records can be removed in one step, keeping what real accounts recorded', async () => {
    const { svc, admin } = await fresh({ sampleData: true });
    const ana = svc.findPeople(admin.id, { query: 'Ana Lopez', type: 'visitor' }).results[0];
    const real = await signIn(svc, admin.id, { personId: ana.id, destinationMode: 'typed', destinationText: 'Front desk' });
    const result = await svc.removeExampleRecords(admin.id, 'Going live');
    assert.equal(result.keptPeople, 1);
    assert.deepEqual(svc.listPeople(admin.id).map((p) => p.id), [ana.id]);
    assert.deepEqual(svc.presentList(admin.id).map((r) => r.visit.id), [real.visit.id]);
    assert.equal(svc.listDestinations(admin.id).length, 0);
    assert.equal(svc.listWatchlist(admin.id).length, 0);
    assert.equal(svc.hasSampleData(), false);
    const entry = svc.auditLog(admin.id)[0];
    assert.equal(entry.data.recordKind, 'example records');
    assert.ok(entry.data.records.length > 40);
  });

  test('backup restores only into an empty installation', async () => {
    const { svc, admin } = await fresh({ sampleData: true });
    const backup = await svc.exportBackup(admin.id);
    assert.match(svc.whyCannotRestore(), /new installation where nothing has been recorded/);
    await rejects(svc.restoreBackup(admin.id, backup), (e) => assert.equal(e.code, 'forbidden'));

    const empty = await Service.open(new MemoryStore(), { iterations: 1000 });
    await rejects(empty.restoreBackup(null, { format: 'something else' }), (e) => assert.match(e.message, /not a Stronghold backup/));
    await empty.restoreBackup(null, JSON.parse(JSON.stringify(backup)));
    assert.equal(empty.presentList(admin.id).length, 3);
    assert.ok((await empty.logIn('dana', 'correct horse')).id);
    assert.match(empty.auditLog(admin.id)[0].summary, /Restored records from a backup/);
  });
});

describe('review findings', () => {
  // A lock shared by two copies of the service, like navigator.locks shared by two tabs.
  function sharedLock() {
    let tail = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => {});
      return run;
    };
  }

  test('two copies writing to one store cannot sign the same person in twice or reuse numbers', async () => {
    const store = new MemoryStore();
    const lock = sharedLock();
    const a = await Service.open(store, { iterations: 1000, lock });
    const admin = await a.setUp({ siteName: 'R', displayName: 'Dana', username: 'dana', password: 'correct horse', confirm: 'correct horse', sampleData: true });
    const b = await Service.open(store, { iterations: 1000, lock });
    const ana = a.findPeople(admin.id, { query: 'Ana Lopez', type: 'visitor' }).results[0];
    const input = { personId: ana.id, destinationMode: 'typed', destinationText: 'Front desk' };
    const results = await Promise.allSettled([a.commitSignIn(admin.id, input, 'no match'), b.commitSignIn(admin.id, input, 'no match')]);
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'signed-in');
    const c = await Service.open(store, { iterations: 1000 });
    const open = c.presentList(admin.id).filter((r) => r.person.id === ana.id);
    assert.equal(open.length, 1);
    await Promise.all([a.addDestination(admin.id, 'Gym'), b.addDestination(admin.id, 'Library')]);
    const reread = await Service.open(store, { iterations: 1000 });
    const seqs = reread.auditLog(admin.id).map((e) => e.seq);
    assert.equal(new Set(seqs).size, seqs.length, 'every audit entry kept, none overwritten');
    const numbers = [...reread.state.visits.values()].map((v) => v.number);
    assert.equal(new Set(numbers).size, numbers.length, 'visit numbers unique');
  });

  test('restore is refused once anything has been recorded, even after every person is deleted', async () => {
    const { svc, admin } = await fresh();
    const backup = await svc.exportBackup(admin.id);
    assert.match(svc.whyCannotRestore(), /new installation/, 'the backup download itself is a recorded action');
    const { svc: other, admin: a2, c } = await fresh();
    await other.addDestination(a2.id, 'Main Office');
    const d = other.listDestinations(a2.id)[0].id;
    const r = await signIn(other, a2.id, { person: ana, destinationMode: 'list', destinationId: d });
    await other.signOut(a2.id, [r.visit.id]);
    c.advance(60 * 24 * 400);
    await other.deleteExpiredVisits(a2.id, [r.visit.id], 'retention', { deleteOrphans: true });
    assert.equal(other.listPeople(a2.id).length, 0);
    await rejects(other.restoreBackup(a2.id, backup), (e) => assert.equal(e.code, 'forbidden'));
  });

  test('restoring into a set-up installation keeps its Audit Log entries', async () => {
    const { svc, admin } = await fresh({ sampleData: true });
    const backup = JSON.parse(JSON.stringify(await svc.exportBackup(admin.id)));
    const { svc: target, admin: other } = await fresh();
    assert.equal(target.whyCannotRestore(), null);
    await target.restoreBackup(other.id, backup);
    const log = target.auditLog(admin.id);
    assert.match(log[0].summary, /Restored records from a backup/);
    assert.ok(log.some((e) => e.data.madeBeforeRestore && e.kind === 'setup'), 'the target’s own setup entry is kept');
    assert.equal(new Set(log.map((e) => e.seq)).size, log.length);
    assert.equal(target.presentList(admin.id).length, 3);
  });

  test('an admitted hold records the Operator who submitted it; the decider is in the Audit Log', async () => {
    const { svc, admin } = await fresh();
    await svc.addWatchlistEntry(admin.id, { firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' });
    const lead = await svc.addUser(admin.id, { displayName: 'Sec Lead', username: 'lead', roles: ['admin'], password: 'lead password', confirm: 'lead password' });
    const held = await signIn(svc, admin.id, { person: { type: 'visitor', firstName: 'Marcus', lastName: 'Reed', dob: '1990-01-01' }, destinationMode: 'typed', destinationText: 'Lobby' });
    const d = await svc.decideHold(lead.id, held.hold.id, { decision: 'admit', reason: 'ID checked' });
    assert.equal(d.visit.signedInBy.id, admin.id);
    assert.equal(svc.auditLog(admin.id).find((e) => e.kind === 'decision').actor.id, lead.id);
  });

  test('audit entries outside decisions name records by number or id, not by personal details (CON_000_005)', async () => {
    const { svc, admin, c } = await fresh();
    const w = await svc.addWatchlistEntry(admin.id, { firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' });
    await svc.changeWatchlistEntry(admin.id, w.id, { firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-23' });
    const r = await signIn(svc, admin.id, { person: ana, destinationMode: 'typed', destinationText: 'Lobby' });
    await svc.updatePerson(admin.id, r.person.id, { ...ana, dob: '1988-04-13' }, 'typo');
    c.advance(10);
    await svc.signOut(admin.id, [r.visit.id]);
    const v = svc.getPerson(admin.id, r.person.id).visits[0];
    await svc.correctVisit(admin.id, v.id, { signInAt: v.signInAt, signOutAt: v.signOutAt, destination: 'Records' }, 'moved');
    const text = JSON.stringify(svc.auditLog(admin.id).filter((e) => e.kind !== 'decision'));
    for (const detail of ['Marcus', 'Reed', '1985-07', 'Lopez', '1988-04']) assert.ok(!text.includes(detail), `${detail} in the log`);
  });

  test('find on Sign In and the search box on lists match the same way', async () => {
    const { svc, admin } = await fresh({ sampleData: true });
    const { textQueryMatches } = await import('../../src/core/text.js');
    assert.equal(svc.findPeople(admin.id, { query: 'lop', type: 'visitor' }).results.length, 1);
    assert.equal(svc.findPeople(admin.id, { query: 'opez', type: 'visitor' }).results.length, 0);
    assert.ok(textQueryMatches('Ana Lopez Main Office', 'lop'));
    assert.ok(!textQueryMatches('Ana Lopez Main Office', 'opez'));
  });
});

describe('helpers', () => {
  test('names match without regard to case, accents, punctuation or order', () => {
    assert.ok(nameMatches({ firstName: 'José-Luis', lastName: "O'Neil" }, { firstName: 'jose luis', lastName: 'ONEIL' }));
    assert.ok(nameMatches({ firstName: 'Reed', lastName: 'Marcus' }, { firstName: 'Marcus', lastName: 'Reed' }));
    assert.ok(!nameMatches({ firstName: 'Mark', lastName: 'Reed' }, { firstName: 'Marcus', lastName: 'Reed' }));
    assert.equal(screenPerson({ firstName: 'a', lastName: 'b', dob: '2000-01-01' }, [], { available: false, cause: 'x' }).outcome, 'not run');
  });

  test('CSV cells are quoted and formula-like text is neutralised', () => {
    assert.equal(toCsv(['a', 'b'], [['=SUM(1)', 'x,"y"']]), 'a,b\r\n\'=SUM(1),"x,""y"""\r\n');
  });

  test('every page shows the version in package.json (REQ_000_047)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
    assert.equal(APP_VERSION, pkg.version);
  });
});
