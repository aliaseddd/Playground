// The Stronghold service: every rule about people, visits, screening, accounts and records.
// Pages call it; it never touches the DOM. Each command checks the caller's account and role,
// stages its changes, writes them to the store in one atomic commit, and only then updates the
// in-memory state, so a failed write leaves nothing half done.

import { STORE_NAMES } from './memory-store.js';
import {
  cleanText,
  normalizeName,
  fullName,
  compareByName,
  isIsoDate,
  localIsoDate,
  startOfLocalDay,
  startOfNextLocalDay,
  nameQueryMatches,
} from './text.js';
import { screenPerson, holdReason, NO_MATCH } from './screening.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { buildSampleData } from './sample.js';
import { APP_VERSION, SCHEMA_VERSION } from './version.js';

export const ROLES = { operator: 'Operator', admin: 'Administrator' };
export const PERSON_TYPES = { visitor: 'Visitor', contractor: 'Contractor' };
export const DEFAULT_RETENTION_DAYS = 365;
export const MAX_RETENTION_DAYS = 3650;

const DEFAULT_SETTINGS = { id: 'settings', siteName: '', retentionDays: DEFAULT_RETENTION_DAYS, watchlistAvailable: true };
const SYSTEM_ACTOR = { id: 'system', name: 'Stronghold', username: null };
const EXAMPLE_ACTOR = { id: 'example', name: 'Example data', username: null };

// An error the person at the desk can act on. `missing` names each required detail left empty
// (REQ_000_050); `field` names the one field at fault, when there is one.
export class UserError extends Error {
  constructor(message, { code = 'invalid', missing = [], field = null } = {}) {
    super(message);
    this.name = 'UserError';
    this.code = code;
    this.missing = missing;
    this.field = field;
  }
}

function missingError(missing) {
  return new UserError(`Fill in the required ${missing.length === 1 ? 'detail' : 'details'}: ${missing.join(', ')}.`, {
    code: 'missing',
    missing,
  });
}

function requireFilled(pairs) {
  const missing = pairs.filter(([, value]) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)).map(([name]) => name);
  if (missing.length) throw missingError(missing);
}

function newId(prefix) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function ref(user) {
  return { id: user.id, name: user.displayName, username: user.username };
}

function publicUser(u) {
  const { password, ...rest } = u;
  return { ...rest, roles: [...u.roles] };
}

function personKey(p) {
  return `${normalizeName(p.firstName)}|${normalizeName(p.lastName)}|${p.dob}`;
}

function personSnapshot(p) {
  return { type: p.type, firstName: p.firstName, lastName: p.lastName, dob: p.dob, company: p.company || null };
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// Changes staged by one command, read back before they are committed.
class Tx {
  constructor(state) {
    this.state = state;
    this.pending = new Map();
  }
  key(store, id) {
    return `${store}\u0000${id}`;
  }
  get(store, id) {
    const k = this.key(store, id);
    if (this.pending.has(k)) return this.pending.get(k).value ?? undefined;
    return this.state[store].get(id);
  }
  put(store, value) {
    this.pending.set(this.key(store, value.id), { store, id: value.id, value });
    return value;
  }
  del(store, id) {
    this.pending.set(this.key(store, id), { store, id, value: null });
  }
  changes() {
    return [...this.pending.values()];
  }
  applyTo(state) {
    for (const { store, id, value } of this.pending.values()) {
      if (value === null) state[store].delete(id);
      else state[store].set(id, value);
    }
  }
}

export class Service {
  static async open(store, options = {}) {
    const service = new Service(store, options);
    await service.reload();
    return service;
  }

  // `lock(fn)` runs fn while no other copy of Stronghold writes to the same store, for example
  // with the browser's Web Locks. Without one, writes are serialized within this copy only.
  constructor(store, { now = () => new Date(), iterations, lock = (fn) => fn() } = {}) {
    this.store = store;
    this.now = now;
    this.iterations = iterations;
    this.lock = lock;
    this.revision = null;
    this.queue = Promise.resolve();
    this.listeners = new Set();
    this.state = Object.fromEntries(STORE_NAMES.map((n) => [n, new Map()]));
  }

  // ---------------------------------------------------------------- plumbing

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(origin) {
    for (const fn of this.listeners) {
      try {
        fn(origin);
      } catch (e) {
        console.error(e);
      }
    }
  }

  _run(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  async _loadAll() {
    const data = await this.store.load();
    this.state = Object.fromEntries(STORE_NAMES.map((n) => [n, new Map((data[n] || []).map((r) => [r.id, r]))]));
    const rev = this.state.meta.get('rev');
    this.revision = rev ? rev.token : null;
  }

  // Re-reads every record from the store, e.g. after another tab wrote.
  reload(origin = null) {
    return this._run(async () => {
      await this._loadAll();
      if (origin) this._emit(origin);
    });
  }

  // Every write holds the lock, first catches up with whatever another copy committed, checks
  // its rules against that, and marks the store with a new revision. So two tabs can never both
  // sign in the same person or hand out the same visit number.
  _write(build) {
    return this._run(() =>
      this.lock(async () => {
        const rev = await this.store.read('meta', 'rev');
        if ((rev ? rev.token : null) !== this.revision) await this._loadAll();
        const tx = new Tx(this.state);
        const result = await build(tx);
        if (tx.changes().length) {
          const token = newId('r');
          tx.put('meta', { id: 'rev', token });
          await this.store.commit(tx.changes());
          tx.applyTo(this.state);
          this.revision = token;
          this._emit('local');
        }
        return result;
      }),
    );
  }

  _nowIso() {
    return this.now().toISOString();
  }

  _next(tx, counter) {
    const counters = tx.get('meta', 'counters') || { id: 'counters' };
    const value = (counters[counter] || 0) + 1;
    tx.put('meta', { ...counters, [counter]: value });
    return value;
  }

  _audit(tx, actor, kind, summary, data = {}) {
    const seq = this._next(tx, 'audit');
    tx.put('audit', { id: `a${String(seq).padStart(9, '0')}`, seq, at: this._nowIso(), actor, kind, summary, data });
  }

  // The signed-in user behind a call, refused if the account is gone, disabled or lacks the role.
  _user(userId, roles = null) {
    const u = this.state.users.get(userId);
    if (!u || u.disabled) {
      throw new UserError('Your session has ended because your account is disabled or no longer exists. Log in again.', { code: 'session' });
    }
    if (roles && !roles.some((r) => u.roles.includes(r))) {
      throw new UserError(`Only ${roles.map((r) => ROLES[r]).join(' or ')} accounts can do this.`, { code: 'forbidden' });
    }
    return u;
  }

  describeStore() {
    return this.store.describe();
  }

  settings() {
    return { ...DEFAULT_SETTINGS, ...(this.state.meta.get('settings') || {}) };
  }

  hasSampleData() {
    return Boolean(this.state.meta.get('sample'));
  }

  // ---------------------------------------------------------------- setup and accounts

  isSetUp() {
    return this.state.users.size > 0;
  }

  async setUp(input) {
    if (this.isSetUp()) throw new UserError('Stronghold is already set up. Log in instead.', { code: 'state' });
    const siteName = cleanText(input.siteName);
    const displayName = cleanText(input.displayName);
    const username = cleanText(input.username).toLowerCase();
    requireFilled([
      ['Building name', siteName],
      ['Your name', displayName],
      ['Username', username],
      ['Password', input.password],
      ['Confirm password', input.confirm],
    ]);
    checkUsername(username);
    checkPassword(input.password, input.confirm);
    const password = await hashPassword(input.password, this.iterations);
    return this._write((tx) => {
      if (this.isSetUp()) throw new UserError('Stronghold is already set up. Log in instead.', { code: 'state' });
      const now = this._nowIso();
      const user = { id: newId('u'), username, displayName, roles: ['operator', 'admin'], disabled: false, password, createdAt: now, updatedAt: now, lastLoginAt: null };
      tx.put('users', user);
      tx.put('meta', { ...DEFAULT_SETTINGS, siteName });
      tx.put('meta', { id: 'schema', version: SCHEMA_VERSION, createdAt: now });
      this._audit(tx, ref(user), 'setup', `Set up Stronghold for ${siteName} and created the account ${username} with both roles`);
      if (input.sampleData) this._addSampleData(tx);
      return publicUser(user);
    });
  }

  _addSampleData(tx) {
    const sample = buildSampleData(this.now());
    const now = this._nowIso();
    for (const name of sample.destinations) tx.put('destinations', { id: newId('d'), name, createdAt: now, example: true });
    for (const w of sample.watchlist) tx.put('watchlist', { id: newId('w'), ...w, createdAt: now, updatedAt: now, example: true });
    const people = sample.people.map((p) => tx.put('people', { id: newId('p'), ...p, createdAt: now, createdBy: EXAMPLE_ACTOR, example: true }));
    for (const v of sample.visits) {
      const person = people[v.person];
      const decisionId = v.decision ? newId('x') : null;
      const visit = tx.put('visits', {
        id: newId('v'),
        number: this._next(tx, 'visit'),
        personId: person.id,
        destination: v.destination,
        destinationSource: 'list',
        signInAt: v.signInAt.toISOString(),
        signedInBy: EXAMPLE_ACTOR,
        signOutAt: v.signOutAt ? v.signOutAt.toISOString() : null,
        signedOutBy: v.signOutAt ? EXAMPLE_ACTOR : null,
        screening: v.screening,
        decisionId,
        corrections: 0,
        example: true,
      });
      if (v.decision) {
        this._audit(tx, EXAMPLE_ACTOR, 'decision', `Admitted ${fullName(person)}: ${OUTCOME_SUMMARY[v.screening]} (example)`, {
          decisionId,
          decision: v.decision.decision,
          reason: v.decision.reason,
          screening: v.screening,
          cause: v.decision.cause,
          person: personSnapshot(person),
          matches: [],
          decidedAt: v.signInAt.toISOString(),
          personId: person.id,
          visitId: visit.id,
          visitNumber: visit.number,
        });
      }
    }
    tx.put('meta', { id: 'sample', addedAt: now });
    this._audit(tx, SYSTEM_ACTOR, 'setup', `Added example records: ${plural(sample.destinations.length, 'destination')}, ${plural(sample.watchlist.length, 'watchlist entry', 'watchlist entries')}, ${plural(people.length, 'person', 'people')} and ${plural(sample.visits.length, 'visit')}`);
  }

  // Example records are invented, so they may be removed in one step before real use. This is
  // the one removal of visits outside the retention period, and it touches only visits that the
  // example set created; records made by real accounts stay.
  async removeExampleRecords(userId, reason) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      if (!this.hasSampleData()) throw new UserError('There are no example records to remove.', { code: 'state' });
      const text = cleanText(reason);
      requireFilled([['Reason', text]]);
      const records = [];
      const removedVisits = new Set();
      for (const v of this.state.visits.values()) {
        if (!v.example) continue;
        tx.del('visits', v.id);
        removedVisits.add(v.id);
        records.push({ kind: 'visit', id: v.id });
      }
      const keep = new Set();
      for (const v of this.state.visits.values()) if (!removedVisits.has(v.id)) keep.add(v.personId);
      for (const h of this.state.holds.values()) if (h.personId) keep.add(h.personId);
      let keptPeople = 0;
      for (const p of this.state.people.values()) {
        if (!p.example) continue;
        if (keep.has(p.id)) {
          keptPeople += 1;
          continue;
        }
        tx.del('people', p.id);
        records.push({ kind: 'person', id: p.id });
      }
      for (const d of this.state.destinations.values()) {
        if (!d.example) continue;
        tx.del('destinations', d.id);
        records.push({ kind: 'destination', id: d.id });
      }
      for (const w of this.state.watchlist.values()) {
        if (!w.example) continue;
        tx.del('watchlist', w.id);
        records.push({ kind: 'watchlist entry', id: w.id });
      }
      tx.del('meta', 'sample');
      const counts = (kind) => records.filter((r) => r.kind === kind).length;
      this._audit(tx, ref(actor), 'deletion', `Removed the example records: ${plural(counts('visit'), 'visit')}, ${plural(counts('person'), 'person', 'people')}, ${plural(counts('destination'), 'destination')}, ${plural(counts('watchlist entry'), 'watchlist entry', 'watchlist entries')}`, {
        recordKind: 'example records',
        records,
        reason: text,
      });
      return { removed: records.length, keptPeople };
    });
  }

  async logIn(username, password) {
    const name = cleanText(username).toLowerCase();
    requireFilled([
      ['Username', name],
      ['Password', password],
    ]);
    const user = [...this.state.users.values()].find((u) => u.username === name);
    const ok = user ? await verifyPassword(password, user.password) : false;
    if (!user || !ok) throw new UserError('The username or password is not correct.', { code: 'auth' });
    if (user.disabled) throw new UserError('This account is disabled. An Administrator can enable it on the User Accounts page.', { code: 'auth' });
    await this._write((tx) => {
      const current = tx.get('users', user.id);
      tx.put('users', { ...current, lastLoginAt: this._nowIso() });
    });
    return publicUser(this.state.users.get(user.id));
  }

  // The account behind a stored session, or null when it can no longer be used.
  sessionUser(userId) {
    const u = this.state.users.get(userId);
    return u && !u.disabled ? publicUser(u) : null;
  }

  async changeOwnPassword(userId, { current, password, confirm }) {
    const user = this._user(userId);
    requireFilled([
      ['Current password', current],
      ['New password', password],
      ['Confirm new password', confirm],
    ]);
    if (!(await verifyPassword(current, user.password))) throw new UserError('The current password is not correct.', { field: 'current' });
    checkPassword(password, confirm);
    const hashed = await hashPassword(password, this.iterations);
    await this._write((tx) => {
      const u = tx.get('users', userId);
      tx.put('users', { ...u, password: hashed, updatedAt: this._nowIso() });
      this._audit(tx, ref(u), 'account', `Changed own password (${u.username})`, { userId });
    });
  }

  listUsers(userId) {
    this._user(userId, ['admin']);
    return [...this.state.users.values()].map(publicUser).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async addUser(userId, input) {
    this._user(userId, ['admin']);
    const displayName = cleanText(input.displayName);
    const username = cleanText(input.username).toLowerCase();
    const roles = normalizeRoles(input.roles);
    requireFilled([
      ['Name', displayName],
      ['Username', username],
      ['Roles', roles],
      ['Password', input.password],
      ['Confirm password', input.confirm],
    ]);
    checkUsername(username);
    checkPassword(input.password, input.confirm);
    const password = await hashPassword(input.password, this.iterations);
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      if ([...this.state.users.values()].some((u) => u.username === username)) {
        throw new UserError(`The username ${username} is already taken. Choose another.`, { field: 'username' });
      }
      const now = this._nowIso();
      const user = tx.put('users', { id: newId('u'), username, displayName, roles, disabled: false, password, createdAt: now, updatedAt: now, lastLoginAt: null });
      this._audit(tx, ref(actor), 'account', `Added the account ${username} (${roles.map((r) => ROLES[r]).join(' and ')})`, { userId: user.id, roles });
      return publicUser(user);
    });
  }

  async changeUser(userId, targetId, input) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const target = tx.get('users', targetId);
      if (!target) throw new UserError('This account no longer exists.', { code: 'not-found' });
      const displayName = cleanText(input.displayName);
      const roles = normalizeRoles(input.roles);
      requireFilled([
        ['Name', displayName],
        ['Roles', roles],
      ]);
      if (target.roles.includes('admin') && !roles.includes('admin') && !target.disabled && this._activeAdmins().length === 1) {
        throw new UserError('This is the only active Administrator account, so it must keep the Administrator role.', { field: 'roles' });
      }
      if (displayName === target.displayName && sameRoles(roles, target.roles)) throw new UserError('Nothing was changed.', { code: 'unchanged' });
      tx.put('users', { ...target, displayName, roles, updatedAt: this._nowIso() });
      this._audit(tx, ref(actor), 'account', `Changed the account ${target.username}`, {
        userId: target.id,
        before: { displayName: target.displayName, roles: target.roles },
        after: { displayName, roles },
      });
    });
  }

  async resetPassword(userId, targetId, { password, confirm }) {
    this._user(userId, ['admin']);
    requireFilled([
      ['New password', password],
      ['Confirm new password', confirm],
    ]);
    checkPassword(password, confirm);
    const hashed = await hashPassword(password, this.iterations);
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const target = tx.get('users', targetId);
      if (!target) throw new UserError('This account no longer exists.', { code: 'not-found' });
      tx.put('users', { ...target, password: hashed, updatedAt: this._nowIso() });
      this._audit(tx, ref(actor), 'account', `Set a new password for ${target.username}`, { userId: target.id });
    });
  }

  async setUserDisabled(userId, targetId, disabled) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const target = tx.get('users', targetId);
      if (!target) throw new UserError('This account no longer exists.', { code: 'not-found' });
      const why = this.whyCannotDisable(userId, targetId);
      if (disabled && why) throw new UserError(why, { code: 'forbidden' });
      if (target.disabled === disabled) return;
      tx.put('users', { ...target, disabled, updatedAt: this._nowIso() });
      this._audit(tx, ref(actor), 'account', `${disabled ? 'Disabled' : 'Enabled'} the account ${target.username}`, { userId: target.id, disabled });
    });
  }

  // Why an account cannot be disabled, or null when it can (REQ_000_041 needs the reason).
  whyCannotDisable(userId, targetId) {
    const target = this.state.users.get(targetId);
    if (!target) return 'This account no longer exists.';
    if (targetId === userId) return 'You cannot disable the account you are logged in with.';
    if (target.roles.includes('admin') && !target.disabled && this._activeAdmins().length === 1) {
      return 'This is the only active Administrator account.';
    }
    return null;
  }

  _activeAdmins() {
    return [...this.state.users.values()].filter((u) => !u.disabled && u.roles.includes('admin'));
  }

  // ---------------------------------------------------------------- people

  _index() {
    const open = new Map();
    const last = new Map();
    const count = new Map();
    for (const v of this.state.visits.values()) {
      if (!v.signOutAt) open.set(v.personId, v);
      count.set(v.personId, (count.get(v.personId) || 0) + 1);
      const prev = last.get(v.personId);
      if (!prev || prev < v.signInAt) last.set(v.personId, v.signInAt);
    }
    const heldById = new Map();
    const heldByKey = new Map();
    for (const h of this.state.holds.values()) {
      if (h.personId) heldById.set(h.personId, h);
      else heldByKey.set(h.personKey, h);
    }
    return { open, last, count, heldById, heldByKey };
  }

  _personRow(p, idx) {
    const openVisit = idx.open.get(p.id) || null;
    const hold = idx.heldById.get(p.id) || null;
    return {
      ...p,
      openVisit,
      hold,
      status: openVisit ? 'in' : hold ? 'held' : 'out',
      visitCount: idx.count.get(p.id) || 0,
      lastVisitAt: idx.last.get(p.id) || null,
    };
  }

  listPeople(userId, { type = null } = {}) {
    this._user(userId, ['operator']);
    const idx = this._index();
    return [...this.state.people.values()]
      .filter((p) => !type || p.type === type)
      .map((p) => this._personRow(p, idx))
      .sort(compareByName);
  }

  // Name search for the Sign In page (REQ_000_001). Results of the other person type are only
  // counted, so the page can say they exist instead of hiding them.
  findPeople(userId, { query, type }) {
    this._user(userId, ['operator']);
    const q = cleanText(query);
    requireFilled([['Name', q]]);
    const idx = this._index();
    const found = [...this.state.people.values()].filter((p) => nameQueryMatches(p, q));
    const otherTypes = {};
    for (const p of found) if (p.type !== type) otherTypes[p.type] = (otherTypes[p.type] || 0) + 1;
    return {
      results: found.filter((p) => p.type === type).map((p) => this._personRow(p, idx)).sort(compareByName),
      otherTypes,
    };
  }

  getPerson(userId, personId) {
    this._user(userId, ['operator']);
    const p = this.state.people.get(personId);
    if (!p) throw new UserError('This person record no longer exists.', { code: 'not-found' });
    const visits = [...this.state.visits.values()].filter((v) => v.personId === personId).sort((a, b) => (a.signInAt < b.signInAt ? 1 : -1));
    return { person: this._personRow(p, this._index()), visits };
  }

  _validatePersonDetails(input, { requireType = true } = {}) {
    const type = input.type;
    const firstName = cleanText(input.firstName);
    const lastName = cleanText(input.lastName);
    const dob = cleanText(input.dob);
    const company = type === 'contractor' ? cleanText(input.company) : '';
    const pairs = [];
    if (requireType) pairs.push(['Person type', PERSON_TYPES[type] ? type : '']);
    pairs.push(['First name', firstName], ['Last name', lastName], ['Date of birth', dob]);
    if (type === 'contractor') pairs.push(['Company', company]);
    requireFilled(pairs);
    this._checkDob(dob);
    return { type, firstName, lastName, dob, company: company || null };
  }

  _checkDob(dob, field = 'dob') {
    if (!isIsoDate(dob)) throw new UserError('Date of birth must be a real date.', { field });
    if (dob > localIsoDate(this.now())) throw new UserError('Date of birth cannot be in the future.', { field });
    if (dob < '1900-01-01') throw new UserError('Date of birth must be in 1900 or later.', { field });
  }

  async updatePerson(userId, personId, input, reason) {
    return this._write((tx) => {
      const actor = this._user(userId, ['operator']);
      const p = tx.get('people', personId);
      if (!p) throw new UserError('This person record no longer exists.', { code: 'not-found' });
      const details = this._validatePersonDetails({ ...input, type: input.type || p.type });
      requireFilled([['Reason for the change', cleanText(reason)]]);
      const before = personSnapshot(p);
      const after = personSnapshot(details);
      const changed = Object.keys(after).filter((k) => (before[k] || null) !== (after[k] || null));
      if (!changed.length) throw new UserError('Nothing was changed.', { code: 'unchanged' });
      tx.put('people', { ...p, ...details, updatedAt: this._nowIso() });
      this._audit(tx, ref(actor), 'person-change', `Changed the details of person record ${personId}`, {
        personId,
        fields: changed,
        reason: cleanText(reason),
      });
    });
  }

  // Why a person record cannot be deleted, or null when it can.
  whyCannotDeletePerson(personId) {
    const visits = [...this.state.visits.values()].filter((v) => v.personId === personId).length;
    if (visits) {
      return `This record has ${plural(visits, 'visit')}. Visits are deleted only after the retention period, on the Expired Visits page; the record can be deleted once none remain.`;
    }
    if ([...this.state.holds.values()].some((h) => h.personId === personId)) return 'A held sign-in for this person is waiting for a decision.';
    return null;
  }

  async deletePerson(userId, personId, reason) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const p = tx.get('people', personId);
      if (!p) throw new UserError('This person record no longer exists.', { code: 'not-found' });
      requireFilled([['Reason', cleanText(reason)]]);
      const why = this.whyCannotDeletePerson(personId);
      if (why) throw new UserError(why, { code: 'forbidden' });
      tx.del('people', personId);
      this._audit(tx, ref(actor), 'deletion', `Deleted a person record (${personId})`, { recordKind: 'person', recordId: personId, reason: cleanText(reason) });
    });
  }

  // ---------------------------------------------------------------- sign-in, screening and holds

  _availability() {
    return this.settings().watchlistAvailable
      ? { available: true, cause: null }
      : { available: false, cause: 'an Administrator has switched watchlist screening off in Settings' };
  }

  _screen(person) {
    const result = screenPerson(person, [...this.state.watchlist.values()], this._availability());
    return { ...result, reason: holdReason(result.outcome, result.cause) };
  }

  // Validates a sign-in request. `input` is either { personId } for a returning person or
  // { person: { type, firstName, lastName, dob, company } } for a new entry, plus
  // { destinationMode: 'list' | 'typed', destinationId, destinationText, print, confirmNew }.
  _parseSignIn(input) {
    let existing = null;
    let person;
    if (input.personId) {
      existing = this.state.people.get(input.personId);
      if (!existing) throw new UserError('This person record no longer exists. Search again.', { code: 'not-found' });
      person = personSnapshot(existing);
    } else {
      person = this._validatePersonDetailsWithDestination(input);
    }
    const { destination, destinationSource } = this._parseDestination(input);
    return { existing, person, destination, destinationSource };
  }

  _validatePersonDetailsWithDestination(input) {
    // Collect every missing detail, the destination included, in form order.
    const p = input.person || {};
    const missing = [];
    if (!PERSON_TYPES[p.type]) missing.push('Person type');
    if (!cleanText(p.firstName)) missing.push('First name');
    if (!cleanText(p.lastName)) missing.push('Last name');
    if (!cleanText(p.dob)) missing.push('Date of birth');
    if (p.type === 'contractor' && !cleanText(p.company)) missing.push('Company');
    if (input.destinationMode === 'typed' ? !cleanText(input.destinationText) : !input.destinationId) missing.push('Destination');
    if (missing.length) throw missingError(missing);
    return this._validatePersonDetails(p);
  }

  _parseDestination(input) {
    if (input.destinationMode === 'typed') {
      const text = cleanText(input.destinationText);
      requireFilled([['Destination', text]]);
      if (text.length > 80) throw new UserError('Destination must be 80 characters or fewer.', { field: 'destinationText' });
      return { destination: text, destinationSource: 'typed' };
    }
    requireFilled([['Destination', input.destinationId]]);
    const d = this.state.destinations.get(input.destinationId);
    if (!d) throw new UserError('That destination was just removed from the list. Choose another.', { field: 'destination' });
    return { destination: d.name, destinationSource: 'list' };
  }

  // REQ_000_010: a person already signed in, or with a held sign-in, cannot be signed in again.
  _checkNotPresent(parsed) {
    const idx = this._index();
    if (parsed.existing) {
      if (idx.open.has(parsed.existing.id)) {
        throw new UserError(`${fullName(parsed.existing)} is already signed in. Sign them out on Currently Signed In before signing them in again.`, { code: 'signed-in' });
      }
      if (idx.heldById.has(parsed.existing.id)) {
        throw new UserError(`A sign-in for ${fullName(parsed.existing)} is already held and waiting for a decision on Held Sign-Ins.`, { code: 'held' });
      }
    } else if (idx.heldByKey.has(personKey(parsed.person))) {
      throw new UserError(`A sign-in for ${fullName(parsed.person)} is already held and waiting for a decision on Held Sign-Ins.`, { code: 'held' });
    }
  }

  // Records whose name and date of birth equal those of a new entry (REQ_000_027).
  _duplicates(person) {
    const key = personKey(person);
    const idx = this._index();
    return [...this.state.people.values()].filter((p) => personKey(p) === key).map((p) => this._personRow(p, idx));
  }

  // Step 1 of a sign-in: validate and screen, without recording anything, so the desk sees the
  // screening result before any visit exists (REQ_000_017).
  screenSignIn(userId, input) {
    this._user(userId, ['operator']);
    const parsed = this._parseSignIn(input);
    this._checkNotPresent(parsed);
    if (!parsed.existing && !input.confirmNew) {
      const candidates = this._duplicates(parsed.person);
      if (candidates.length) return { status: 'duplicates', candidates, person: parsed.person };
    }
    return { status: 'screened', screening: this._screen(parsed.person), person: parsed.person, destination: parsed.destination };
  }

  // Step 2: screen again and act on the result the desk was shown. If the result has changed
  // since (the watchlist was edited in between), nothing is recorded and the new result is
  // returned to be shown first.
  async commitSignIn(userId, input, shownOutcome) {
    return this._write((tx) => {
      const actor = this._user(userId, ['operator']);
      const parsed = this._parseSignIn(input);
      this._checkNotPresent(parsed);
      if (!parsed.existing && !input.confirmNew && this._duplicates(parsed.person).length) {
        return { status: 'duplicates', candidates: this._duplicates(parsed.person), person: parsed.person };
      }
      const screening = this._screen(parsed.person);
      if (screening.outcome !== shownOutcome) return { status: 'rescreened', screening, person: parsed.person };
      if (screening.outcome === NO_MATCH) {
        const { person, visit } = this._admit(tx, actor, parsed, screening.outcome, null);
        return { status: 'signed-in', screening, person, visit };
      }
      const hold = tx.put('holds', {
        id: newId('h'),
        personId: parsed.existing ? parsed.existing.id : null,
        person: parsed.person,
        personKey: personKey(parsed.person),
        destination: parsed.destination,
        destinationSource: parsed.destinationSource,
        print: Boolean(input.print),
        screening: screening.outcome,
        matches: screening.matches,
        cause: screening.cause,
        reason: screening.reason,
        createdAt: this._nowIso(),
        createdBy: ref(actor),
      });
      return { status: 'held', screening, hold };
    });
  }

  // `signedInBy` is the Operator who asked for the sign-in; for a held sign-in that is the
  // person who submitted it, while the person who decided is in the Audit Log.
  _admit(tx, actor, parsed, outcome, decisionId, signedInBy = ref(actor)) {
    let person = parsed.existing;
    if (!person) {
      person = tx.put('people', { id: newId('p'), ...parsed.person, createdAt: this._nowIso(), createdBy: ref(actor) });
    }
    const visit = tx.put('visits', {
      id: newId('v'),
      number: this._next(tx, 'visit'),
      personId: person.id,
      destination: parsed.destination,
      destinationSource: parsed.destinationSource,
      signInAt: this._nowIso(),
      signedInBy,
      signOutAt: null,
      signedOutBy: null,
      screening: outcome,
      decisionId,
      corrections: 0,
    });
    return { person, visit };
  }

  listHolds(userId) {
    this._user(userId);
    return [...this.state.holds.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  getHold(userId, holdId) {
    this._user(userId);
    const hold = this.state.holds.get(holdId);
    if (!hold) throw new UserError('This held sign-in has already been decided.', { code: 'not-found' });
    return hold;
  }

  // Any logged-in user may admit or refuse a held person, stating a reason (REQ_000_020, 021).
  async decideHold(userId, holdId, { decision, reason }) {
    return this._write((tx) => {
      const actor = this._user(userId);
      const hold = tx.get('holds', holdId);
      if (!hold) throw new UserError('This held sign-in has already been decided.', { code: 'not-found' });
      const text = cleanText(reason);
      requireFilled([
        ['Decision', decision === 'admit' || decision === 'refuse' ? decision : ''],
        ['Reason', text],
      ]);
      const decisionId = newId('x');
      let admitted = null;
      if (decision === 'admit') {
        const existing = hold.personId ? tx.get('people', hold.personId) : null;
        if (hold.personId && !existing) throw new UserError('This person record was deleted while the sign-in was held. Refuse the sign-in and start again.', { code: 'not-found' });
        if (existing && this._index().open.has(existing.id)) throw new UserError(`${fullName(existing)} is already signed in.`, { code: 'signed-in' });
        admitted = this._admit(tx, actor, { existing, person: hold.person, destination: hold.destination, destinationSource: hold.destinationSource }, hold.screening, decisionId, hold.createdBy);
      }
      tx.del('holds', hold.id);
      this._audit(tx, ref(actor), 'decision', `${decision === 'admit' ? 'Admitted' : 'Refused'} ${fullName(hold.person)}: ${OUTCOME_SUMMARY[hold.screening]}`, {
        decisionId,
        decision,
        reason: text,
        screening: hold.screening,
        cause: hold.cause,
        person: { firstName: hold.person.firstName, lastName: hold.person.lastName, dob: hold.person.dob, type: hold.person.type, company: hold.person.company },
        matches: hold.matches,
        heldAt: hold.createdAt,
        heldBy: hold.createdBy,
        decidedAt: this._nowIso(),
        personId: admitted ? admitted.person.id : hold.personId,
        visitId: admitted ? admitted.visit.id : null,
        visitNumber: admitted ? admitted.visit.number : null,
      });
      return { decision, print: hold.print, person: admitted && admitted.person, visit: admitted && admitted.visit };
    });
  }

  // ---------------------------------------------------------------- presence and sign-out

  // REQ_000_011: exactly the people with an open visit.
  presentList(userId) {
    this._user(userId, ['operator']);
    return [...this.state.visits.values()]
      .filter((v) => !v.signOutAt)
      .map((v) => ({ visit: v, person: this.state.people.get(v.personId) }))
      .filter((row) => row.person)
      .sort((a, b) => (a.visit.signInAt < b.visit.signInAt ? 1 : -1));
  }

  async signOut(userId, visitIds) {
    if (!visitIds || !visitIds.length) throw new UserError('Choose at least one person to sign out.', { code: 'missing' });
    return this._write((tx) => {
      const actor = this._user(userId, ['operator']);
      const signedOut = [];
      const skipped = [];
      for (const id of visitIds) {
        const v = tx.get('visits', id);
        if (!v) throw new UserError('One of these visits no longer exists. Refresh the list.', { code: 'not-found' });
        const person = this.state.people.get(v.personId);
        if (v.signOutAt) {
          skipped.push({ visit: v, person });
          continue;
        }
        const updated = tx.put('visits', { ...v, signOutAt: this._nowIso(), signedOutBy: ref(actor) });
        signedOut.push({ visit: updated, person });
      }
      return { signedOut, skipped };
    });
  }

  // REQ_000_035: a recorded sign-in or sign-out changes only with a logged reason.
  async correctVisit(userId, visitId, input, reason) {
    return this._write((tx) => {
      const actor = this._user(userId);
      const v = tx.get('visits', visitId);
      if (!v) throw new UserError('This visit no longer exists.', { code: 'not-found' });
      const destination = cleanText(input.destination);
      const text = cleanText(reason);
      requireFilled([
        ['Signed in', input.signInAt],
        ['Destination', destination],
        ['Reason for the change', text],
      ]);
      const signInAt = toIso(input.signInAt, 'Signed in');
      const signOutAt = input.signOutAt ? toIso(input.signOutAt, 'Signed out') : null;
      const now = this._nowIso();
      if (v.signOutAt && !signOutAt) {
        throw new UserError('A recorded sign-out can be moved but not removed. To put someone back on Currently Signed In, sign them in again.', { field: 'signOutAt' });
      }
      if (signInAt > now) throw new UserError('The sign-in time cannot be in the future.', { field: 'signInAt' });
      if (signOutAt && signOutAt > now) throw new UserError('The sign-out time cannot be in the future.', { field: 'signOutAt' });
      if (signOutAt && signOutAt < signInAt) throw new UserError('The sign-out time must be after the sign-in time.', { field: 'signOutAt' });
      const before = { signInAt: v.signInAt, signOutAt: v.signOutAt, destination: v.destination };
      const after = { signInAt, signOutAt, destination };
      const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
      if (!changed.length) throw new UserError('Nothing was changed.', { code: 'unchanged' });
      const updated = {
        ...v,
        ...after,
        destinationSource: destination === v.destination ? v.destinationSource : 'typed',
        corrections: (v.corrections || 0) + 1,
        correctedAt: now,
      };
      if (!v.signOutAt && signOutAt) updated.signedOutBy = ref(actor);
      tx.put('visits', updated);
      this._audit(tx, ref(actor), 'visit-correction', `Corrected visit ${v.number}`, {
        visitId,
        visitNumber: v.number,
        before: pick(before, changed),
        after: pick(after, changed),
        reason: text,
      });
    });
  }

  // REQ_000_022, 023: badge data only while the visit is open. No screening result (CON_000_004)
  // and no date of birth.
  badge(userId, visitId) {
    this._user(userId, ['operator']);
    const v = this.state.visits.get(visitId);
    if (!v) throw new UserError('This visit no longer exists.', { code: 'not-found' });
    const why = this.whyNoBadge(v);
    if (why) throw new UserError(why, { code: 'no-open-visit' });
    const p = this.state.people.get(v.personId);
    return {
      number: v.number,
      type: p.type,
      firstName: p.firstName,
      lastName: p.lastName,
      company: p.type === 'contractor' ? p.company : null,
      destination: v.destination,
      signInAt: v.signInAt,
      siteName: this.settings().siteName,
    };
  }

  whyNoBadge(visit) {
    if (!visit) return 'This person is not signed in. Badges print only for people who are signed in.';
    if (visit.signOutAt) return 'This visit has ended. Badges print only for people who are signed in.';
    return null;
  }

  stats(userId) {
    const u = this.sessionUser(userId);
    if (!u) return { present: 0, held: 0 };
    let present = 0;
    for (const v of this.state.visits.values()) if (!v.signOutAt) present += 1;
    return { present, held: this.state.holds.size };
  }

  // ---------------------------------------------------------------- report

  // REQ_000_026: every visit whose sign-in time lies within the date range (local days, inclusive).
  report(userId, { from, to, type = '', destination = '' }) {
    this._user(userId, ['operator']);
    requireFilled([
      ['From', from],
      ['To', to],
    ]);
    if (!isIsoDate(from)) throw new UserError('From must be a real date.', { field: 'from' });
    if (!isIsoDate(to)) throw new UserError('To must be a real date.', { field: 'to' });
    if (from > to) throw new UserError('From must be on or before To.', { field: 'from' });
    const start = startOfLocalDay(from).toISOString();
    const end = startOfNextLocalDay(to).toISOString();
    const rows = [...this.state.visits.values()]
      .filter((v) => v.signInAt >= start && v.signInAt < end)
      .map((v) => ({ visit: v, person: this.state.people.get(v.personId) }))
      .filter((r) => r.person && (!type || r.person.type === type) && (!destination || r.visit.destination === destination))
      .sort((a, b) => (a.visit.signInAt < b.visit.signInAt ? -1 : 1));
    return { from, to, type, destination, rows };
  }

  // Destination names used by visits in the store, for the report's filter.
  usedDestinations(userId) {
    this._user(userId, ['operator']);
    const names = new Set([...this.state.destinations.values()].map((d) => d.name));
    for (const v of this.state.visits.values()) names.add(v.destination);
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  // ---------------------------------------------------------------- destinations

  listDestinations(userId) {
    this._user(userId);
    return [...this.state.destinations.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  _checkDestinationName(name, exceptId = null) {
    requireFilled([['Name', name]]);
    if (name.length > 80) throw new UserError('Name must be 80 characters or fewer.', { field: 'name' });
    const clash = [...this.state.destinations.values()].find((d) => d.id !== exceptId && normalizeName(d.name) === normalizeName(name));
    if (clash) throw new UserError(`The list already has a destination called ${clash.name}.`, { field: 'name' });
  }

  async addDestination(userId, name) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const clean = cleanText(name);
      this._checkDestinationName(clean);
      const d = tx.put('destinations', { id: newId('d'), name: clean, createdAt: this._nowIso() });
      this._audit(tx, ref(actor), 'destination', `Added the destination ${clean}`, { destinationId: d.id });
      return d;
    });
  }

  async renameDestination(userId, id, name) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const d = tx.get('destinations', id);
      if (!d) throw new UserError('This destination no longer exists.', { code: 'not-found' });
      const clean = cleanText(name);
      if (clean === d.name) throw new UserError('Nothing was changed.', { code: 'unchanged' });
      this._checkDestinationName(clean, id);
      tx.put('destinations', { ...d, name: clean, updatedAt: this._nowIso() });
      this._audit(tx, ref(actor), 'destination', `Renamed the destination ${d.name} to ${clean}`, { destinationId: id, before: d.name, after: clean });
    });
  }

  async removeDestination(userId, id, reason) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const d = tx.get('destinations', id);
      if (!d) throw new UserError('This destination no longer exists.', { code: 'not-found' });
      requireFilled([['Reason', cleanText(reason)]]);
      tx.del('destinations', id);
      this._audit(tx, ref(actor), 'deletion', `Removed the destination ${d.name}`, { recordKind: 'destination', recordId: id, name: d.name, reason: cleanText(reason) });
    });
  }

  // ---------------------------------------------------------------- watchlist

  listWatchlist(userId) {
    this._user(userId, ['admin']);
    return [...this.state.watchlist.values()].sort(compareByName);
  }

  _checkWatchlistEntry(input, exceptId = null) {
    const firstName = cleanText(input.firstName);
    const lastName = cleanText(input.lastName);
    const dob = cleanText(input.dob);
    requireFilled([
      ['First name', firstName],
      ['Last name', lastName],
      ['Date of birth', dob],
    ]);
    this._checkDob(dob);
    const key = personKey({ firstName, lastName, dob });
    if ([...this.state.watchlist.values()].some((w) => w.id !== exceptId && personKey(w) === key)) {
      throw new UserError(`The watchlist already has an entry for ${firstName} ${lastName} with this date of birth.`, { field: 'firstName' });
    }
    return { firstName, lastName, dob };
  }

  async addWatchlistEntry(userId, input) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const details = this._checkWatchlistEntry(input);
      const now = this._nowIso();
      const entry = tx.put('watchlist', { id: newId('w'), ...details, createdAt: now, updatedAt: now });
      this._audit(tx, ref(actor), 'watchlist', `Added a watchlist entry (${entry.id})`, { entryId: entry.id });
      return entry;
    });
  }

  async changeWatchlistEntry(userId, id, input) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const entry = tx.get('watchlist', id);
      if (!entry) throw new UserError('This watchlist entry no longer exists.', { code: 'not-found' });
      const details = this._checkWatchlistEntry(input, id);
      const before = { firstName: entry.firstName, lastName: entry.lastName, dob: entry.dob };
      const changed = Object.keys(details).filter((k) => before[k] !== details[k]);
      if (!changed.length) throw new UserError('Nothing was changed.', { code: 'unchanged' });
      tx.put('watchlist', { ...entry, ...details, updatedAt: this._nowIso() });
      this._audit(tx, ref(actor), 'watchlist', `Changed a watchlist entry (${id})`, { entryId: id, fields: changed });
    });
  }

  async removeWatchlistEntry(userId, id, reason) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const entry = tx.get('watchlist', id);
      if (!entry) throw new UserError('This watchlist entry no longer exists.', { code: 'not-found' });
      requireFilled([['Reason', cleanText(reason)]]);
      tx.del('watchlist', id);
      this._audit(tx, ref(actor), 'deletion', `Removed a watchlist entry (${id})`, { recordKind: 'watchlist entry', recordId: id, reason: cleanText(reason) });
    });
  }

  // ---------------------------------------------------------------- settings and retention

  async updateSettings(userId, input) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      const siteName = cleanText(input.siteName);
      const retentionText = cleanText(input.retentionDays);
      requireFilled([
        ['Building name', siteName],
        ['Retention period', retentionText],
      ]);
      if (!/^\d+$/.test(retentionText) || Number(retentionText) < 1 || Number(retentionText) > MAX_RETENTION_DAYS) {
        throw new UserError(`Retention period must be a whole number of days from 1 to ${MAX_RETENTION_DAYS}.`, { field: 'retentionDays' });
      }
      const current = this.settings();
      const next = { ...current, siteName, retentionDays: Number(retentionText), watchlistAvailable: Boolean(input.watchlistAvailable) };
      const fields = ['siteName', 'retentionDays', 'watchlistAvailable'];
      const changed = fields.filter((k) => current[k] !== next[k]);
      if (!changed.length) throw new UserError('Nothing was changed.', { code: 'unchanged' });
      tx.put('meta', next);
      this._audit(tx, ref(actor), 'settings', `Changed settings: ${changed.map((k) => SETTING_LABELS[k]).join(', ')}`, { before: pick(current, changed), after: pick(next, changed) });
    });
  }

  retentionCutoff() {
    const cutoff = new Date(this.now().getTime());
    cutoff.setDate(cutoff.getDate() - this.settings().retentionDays);
    return cutoff;
  }

  // Visits signed out longer ago than the retention period (REQ_000_038). Open visits never expire.
  expiredVisits(userId) {
    this._user(userId, ['admin']);
    const cutoff = this.retentionCutoff().toISOString();
    return [...this.state.visits.values()]
      .filter((v) => v.signOutAt && v.signOutAt < cutoff)
      .map((v) => ({ visit: v, person: this.state.people.get(v.personId) }))
      .sort((a, b) => (a.visit.signOutAt < b.visit.signOutAt ? -1 : 1));
  }

  // The only way a visit leaves the history (REQ_000_039).
  async deleteExpiredVisits(userId, visitIds, reason, { deleteOrphans = false } = {}) {
    return this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      if (!visitIds || !visitIds.length) throw new UserError('Choose at least one visit to delete.', { code: 'missing' });
      const text = cleanText(reason);
      requireFilled([['Reason', text]]);
      const cutoff = this.retentionCutoff().toISOString();
      const touched = new Set();
      for (const id of visitIds) {
        const v = tx.get('visits', id);
        if (!v) throw new UserError('One of these visits no longer exists. Refresh the list.', { code: 'not-found' });
        if (!v.signOutAt || v.signOutAt >= cutoff) throw new UserError(`Visit ${v.number} has not passed the retention period, so it cannot be deleted.`, { code: 'forbidden' });
        tx.del('visits', id);
        touched.add(v.personId);
        this._audit(tx, ref(actor), 'deletion', `Deleted visit ${v.number} after the retention period`, { recordKind: 'visit', recordId: id, visitNumber: v.number, reason: text });
      }
      const deletedPeople = [];
      if (deleteOrphans) {
        const remaining = new Set();
        for (const v of this.state.visits.values()) if (!visitIds.includes(v.id)) remaining.add(v.personId);
        const holding = new Set([...this.state.holds.values()].map((h) => h.personId));
        for (const personId of touched) {
          if (remaining.has(personId) || holding.has(personId) || !tx.get('people', personId)) continue;
          tx.del('people', personId);
          deletedPeople.push(personId);
          this._audit(tx, ref(actor), 'deletion', `Deleted a person record left with no visits (${personId})`, { recordKind: 'person', recordId: personId, reason: text });
        }
      }
      return { visits: visitIds.length, people: deletedPeople.length };
    });
  }

  // ---------------------------------------------------------------- audit log and backup

  auditLog(userId) {
    this._user(userId, ['admin']);
    return [...this.state.audit.values()].sort((a, b) => b.seq - a.seq);
  }

  async exportBackup(userId) {
    await this._write((tx) => {
      const actor = this._user(userId, ['admin']);
      this._audit(tx, ref(actor), 'backup', 'Downloaded a backup of all records');
    });
    const data = await this._run(() => this.lock(() => this.store.load()));
    return { format: 'stronghold-backup', schema: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: this._nowIso(), data };
  }

  // Restoring replaces records, so it is offered only to an installation where nothing has
  // happened beyond setting it up: no person, visit or held sign-in, and no Audit Log entry other
  // than setup. So a restore can never bring back a deleted record or remove a recorded visit
  // (REQ_000_039), and the Audit Log entries already here are kept (REQ_000_036).
  whyCannotRestore() {
    const used =
      this.state.people.size || this.state.visits.size || this.state.holds.size || [...this.state.audit.values()].some((a) => a.kind !== 'setup');
    if (used) {
      return 'Restore replaces records, so it is only available in a new installation where nothing has been recorded yet, for example in a new browser or on a new computer.';
    }
    return null;
  }

  async restoreBackup(userId, backup) {
    if (this.isSetUp()) this._user(userId, ['admin']);
    const why = this.whyCannotRestore();
    if (why) throw new UserError(why, { code: 'forbidden' });
    if (!backup || backup.format !== 'stronghold-backup' || typeof backup.data !== 'object' || backup.data === null) {
      throw new UserError('This file is not a Stronghold backup.', { field: 'file' });
    }
    if (backup.schema !== SCHEMA_VERSION) {
      throw new UserError(`This backup was made by a version of Stronghold whose records this version cannot read (record format ${backup.schema}).`, { field: 'file' });
    }
    const data = {};
    for (const name of STORE_NAMES) {
      const records = backup.data[name] || [];
      if (!Array.isArray(records) || records.some((r) => !r || typeof r.id !== 'string')) {
        throw new UserError('This backup is damaged and cannot be restored.', { field: 'file' });
      }
      data[name] = records;
    }
    if (!data.users.some((u) => !u.disabled && (u.roles || []).includes('admin'))) {
      throw new UserError('This backup has no active Administrator account, so nobody could log in after restoring it.', { field: 'file' });
    }
    await this._run(() =>
      this.lock(async () => {
        await this._loadAll();
        if (this.isSetUp()) this._user(userId, ['admin']);
        const stillWhy = this.whyCannotRestore();
        if (stillWhy) throw new UserError(stillWhy, { code: 'forbidden' });
        const actorUser = (userId && this.state.users.get(userId)) || null;
        // This installation's own entries follow the backup's, then the restore itself.
        let seq = data.audit.reduce((max, a) => Math.max(max, Number(a.seq) || 0), 0);
        const entry = (fields) => {
          seq += 1;
          return { ...fields, id: `a${String(seq).padStart(9, '0')}`, seq };
        };
        const kept = [...this.state.audit.values()].sort((a, b) => a.seq - b.seq).map((a) => entry({ ...a, data: { ...a.data, madeBeforeRestore: true } }));
        const counts = `${plural(data.users.length, 'account')}, ${plural(data.people.length, 'person', 'people')}, ${plural(data.visits.length, 'visit')}`;
        const restored = entry({
          at: this._nowIso(),
          actor: actorUser ? ref(actorUser) : SYSTEM_ACTOR,
          kind: 'backup',
          summary: `Restored records from a backup made ${backup.exportedAt}: ${counts}`,
          data: { exportedAt: backup.exportedAt, appVersion: backup.appVersion },
        });
        const counters = data.meta.find((m) => m.id === 'counters') || { id: 'counters' };
        const meta = [...data.meta.filter((m) => m.id !== 'counters' && m.id !== 'rev'), { ...counters, audit: seq }, { id: 'rev', token: newId('r') }];
        await this.store.replaceAll({ ...data, meta, audit: [...data.audit, ...kept, restored] });
        await this._loadAll();
      }),
    );
    this._emit('local');
  }
}

const OUTCOME_SUMMARY = { match: 'watchlist match', 'possible match': 'possible watchlist match', 'not run': 'screening not run' };

const SETTING_LABELS = { siteName: 'building name', retentionDays: 'retention period', watchlistAvailable: 'watchlist screening' };

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));
}

function normalizeRoles(roles) {
  return ['operator', 'admin'].filter((r) => (roles || []).includes(r));
}

function sameRoles(a, b) {
  return a.length === b.length && a.every((r) => b.includes(r));
}

function checkUsername(username) {
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
    throw new UserError('Username must be 2 to 32 characters: letters, digits, dots, dashes or underscores.', { field: 'username' });
  }
}

function checkPassword(password, confirm) {
  if (String(password).length < 8) throw new UserError('Password must be at least 8 characters.', { field: 'password' });
  if (password !== confirm) throw new UserError('The two passwords do not match.', { field: 'confirm' });
}

function toIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new UserError(`${label} must be a real date and time.`);
  return date.toISOString();
}
