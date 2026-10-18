// Browser tests of the built page, dist/stronghold.html, in headless Chromium.
// Run with `npm run test:e2e`. Needs Playwright: a local install, or a global one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(join(globalRoot, 'playwright'));
  }
}
const { chromium } = loadPlaywright();

const PAGE = pathToFileURL(fileURLToPath(new URL('../../dist/stronghold.html', import.meta.url))).href;
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
let browser;

before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
});

// A fresh browser profile with Stronghold set up and the example records loaded.
async function freshDesk({ claudeViewer = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await context.addInitScript(() => {
    window.__prints = [];
    window.__strongholdPrintHook = (doc, name) => {
      window.__prints.push({ name, doc });
      return 'printed';
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(PAGE);
  await page.fill('#siteName', 'Riverside Civic Center');
  await page.fill('#displayName', 'Dana Whitlock');
  await page.fill('#username', 'dana');
  await page.fill('#password', 'correct horse');
  await page.fill('#confirm', 'correct horse');
  await page.click('text=Create Account and Open Stronghold');
  await page.waitForSelector('h1:has-text("Sign In")');
  return { context, page, errors, claudeViewer };
}

async function menu(page, label) {
  await page.click(`a.menu-link:has-text("${label}")`);
  await page.waitForSelector(`h1:has-text("${label}")`);
}

async function manualEntry(page, { first, last, dob, destination = 'Main Office', submit = 'Submit & Print' }) {
  await page.click('#manual-entry');
  await page.fill('#firstName', first);
  await page.fill('#lastName', last);
  await page.fill('#dob', dob);
  await page.selectOption('#destination', { label: destination });
  await page.click(submit === 'Submit' ? 'button[data-intent="submit"]' : 'button[data-intent="print"]');
}

test('a new visitor is screened, signed in and badged on one page, then signed out (IPQ-09 first run)', async () => {
  const { context, page, errors } = await freshDesk();
  await manualEntry(page, { first: 'Jordan', last: 'Ellis', dob: '1990-03-14' });
  await page.waitForSelector('#done-title');
  assert.equal(new URL(page.url()).hash, '#/sign-in', 'never left the Sign In page (REQ_000_005)');
  assert.match(await page.textContent('.result'), /Screening found no match/);
  await page.waitForFunction(() => window.__prints.length === 1);
  const badge = await page.evaluate(() => window.__prints[0].doc);
  assert.match(badge, /Jordan Ellis/);
  assert.doesNotMatch(badge, /match|1990/i, 'no screening result or date of birth on the badge (CON_000_004)');

  await menu(page, 'Currently Signed In');
  assert.ok(await page.isVisible('tr:has-text("Ellis")'));
  await page.click('tr:has-text("Ellis") button:has-text("Sign Out")');
  await page.waitForSelector('.alert-ok');
  assert.equal(await page.locator('tr:has-text("Ellis")').count(), 0, 'gone from the list after sign-out (REQ_000_011)');

  await menu(page, 'Sign-In Report');
  assert.ok(await page.isVisible('tr:has-text("Ellis")'), 'the visit is in today’s report (REQ_000_026)');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a watchlist match is held with its reason and entry, prints nothing, and is decided with a logged reason', async () => {
  const { context, page, errors } = await freshDesk();
  await manualEntry(page, { first: 'Marcus', last: 'Reed', dob: '1985-07-22', destination: 'Council Chambers' });
  await page.waitForSelector('.hold');
  assert.match(await page.textContent('.hold'), /name and date of birth match a watchlist entry/);
  assert.match(await page.textContent('.hold table'), /Reed, Marcus/);
  assert.equal(await page.evaluate(() => window.__prints.length), 0, 'no badge while held (REQ_000_023)');
  assert.equal(await page.textContent('a.menu-link:has-text("Held Sign-Ins") .count'), '1');

  await page.click('button[data-decision="refuse"]');
  assert.match(await page.textContent('[data-error-summary]'), /Reason/, 'the missing reason is named (REQ_000_050)');
  await page.fill('.decision textarea', 'Trespass order on file.');
  await page.click('button[data-decision="refuse"]');
  await page.waitForSelector('#refused-title');

  await menu(page, 'Audit Log');
  const entry = page.locator('tr:has-text("Refused Marcus Reed")');
  await entry.locator('summary').click();
  const text = await entry.textContent();
  assert.match(text, /Trespass order on file/);
  assert.match(text, /Dana Whitlock/);
  assert.match(text, /Match/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a returning visitor is found by name and signed in without re-entry; a duplicate entry asks first', async () => {
  const { context, page } = await freshDesk();
  await page.fill('#query', 'Lopez');
  await page.click('button:has-text("Find")');
  await page.click('tr:has-text("Lopez") button:has-text("Select")');
  assert.equal(await page.locator('#firstName').count(), 0, 'no name fields to type (REQ_000_001)');
  await page.selectOption('#destination', { label: 'Main Office' });
  await page.click('button[data-intent="submit"]');
  await page.waitForSelector('#done-title');
  assert.equal(await page.evaluate(() => window.__prints.length), 0, 'Submit does not print');

  await page.click('#next-person');
  await manualEntry(page, { first: 'James', last: 'Whitaker', dob: '1975-01-30' });
  await page.waitForSelector('#dup-title');
  assert.match(await page.textContent('#dup-title'), /already exists/, 'never reused without asking (REQ_000_027)');
  await page.click('button:has-text("Use This Record")');
  await page.waitForSelector('#done-title');
  await context.close();
});

test('every page names itself, shows one version, and every unavailable control says why', async () => {
  const { context, page, errors } = await freshDesk();
  const labels = await page.$$eval('a.menu-link span:first-child', (els) => els.map((e) => e.textContent.trim()));
  assert.equal(labels.length, 14);
  for (const label of labels) {
    await menu(page, label);
    assert.equal((await page.textContent('h1')).trim(), label, `heading of ${label} (REQ_000_042)`);
    assert.equal((await page.textContent('.version')).trim(), `v${pkg.version}`, `version on ${label} (REQ_000_047)`);
    const unexplained = await page.$$eval('button[disabled]', (buttons) =>
      buttons.filter((b) => {
        const id = b.getAttribute('aria-describedby');
        const why = id && document.getElementById(id);
        return !why || !why.textContent.trim() || why.offsetParent === null;
      }).length,
    );
    assert.equal(unexplained, 0, `disabled controls without a visible reason on ${label} (REQ_000_041)`);
  }
  await menu(page, 'Held Sign-Ins');
  assert.match(await page.textContent('.empty'), /No sign-ins are held/, 'an empty list says so (REQ_000_048)');
  assert.deepEqual(errors, []);
  await context.close();
});

test('an Operator sees only the desk pages, and an Administrator page says why it is unavailable', async () => {
  const { context, page } = await freshDesk();
  await menu(page, 'User Accounts');
  await page.fill('#uName', 'Sam Desk');
  await page.fill('#uUser', 'sam');
  await page.fill('#uPass', 'desk password');
  await page.fill('#uConfirm', 'desk password');
  await page.click('button:has-text("Add Account")');
  await page.waitForSelector('tr:has-text("sam")');
  await page.click('[data-logout]');
  await page.fill('#username', 'sam');
  await page.fill('#password', 'desk password');
  await page.click('button:has-text("Log In")');
  await page.waitForSelector('h1:has-text("Sign In")');
  const labels = await page.$$eval('a.menu-link span:first-child', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(labels, ['Sign In', 'Held Sign-Ins', 'Currently Signed In', 'People', 'Sign-In Report', 'My Account', 'Help']);
  await page.evaluate(() => {
    location.hash = '#/watchlist';
  });
  await page.waitForSelector('h1:has-text("Page Not Available")');
  assert.match(await page.textContent('main'), /for Administrator accounts/);
  await context.close();
});

test('records survive a reload, and several people sign out together only after confirming', async () => {
  const { context, page } = await freshDesk();
  await menu(page, 'Currently Signed In');
  const before = await page.locator('tbody tr').count();
  await page.check('tbody tr:nth-child(1) input[type=checkbox]');
  await page.check('tbody tr:nth-child(2) input[type=checkbox]');
  await page.click('#sign-out-selected');
  await page.waitForSelector('.dialog');
  await page.click('.dialog [data-cancel]');
  assert.equal(await page.locator('tbody tr').count(), before, 'cancel changes nothing (REQ_000_051)');
  await page.click('#sign-out-selected');
  await page.click('.dialog button[type=submit]');
  await page.waitForSelector('.alert-ok');
  assert.equal(await page.locator('tbody tr').count(), before - 2);
  await page.reload();
  await page.waitForSelector('h1:has-text("Currently Signed In")');
  assert.equal(await page.locator('tbody tr').count(), before - 2, 'the same after a reload (REQ_000_040)');
  await context.close();
});

test('two tabs signing in the same person at once: one succeeds, the other is told why', async () => {
  const { context, page } = await freshDesk();
  const other = await context.newPage();
  await other.goto(PAGE);
  await other.fill('#username', 'dana');
  await other.fill('#password', 'correct horse');
  await other.click('button:has-text("Log In")');
  await other.waitForSelector('h1:has-text("Sign In")');
  for (const p of [page, other]) {
    await p.fill('#query', 'Lopez');
    await p.click('button:has-text("Find")');
    await p.click('tr:has-text("Lopez") button:has-text("Select")');
    await p.selectOption('#destination', { label: 'Main Office' });
  }
  await Promise.all([page.click('button[data-intent="submit"]'), other.click('button[data-intent="submit"]')]);
  await Promise.all([page, other].map((p) => p.waitForSelector('#done-title, [data-error-summary]')));
  const done = (await page.locator('#done-title').count()) + (await other.locator('#done-title').count());
  assert.equal(done, 1, 'exactly one tab signed her in (REQ_000_010)');
  const loser = (await page.locator('#done-title').count()) ? other : page;
  assert.match(await loser.textContent('[data-error-summary]'), /already signed in/);
  await menu(page, 'Currently Signed In');
  assert.equal(await page.locator('tr:has-text("Lopez")').count(), 1);
  await context.close();
});

test('checking a record from Sign In and coming back keeps what was typed', async () => {
  const { context, page } = await freshDesk();
  await page.click('#manual-entry');
  await page.fill('#firstName', 'James');
  await page.fill('#lastName', 'Whitaker');
  await page.fill('#dob', '1975-01-30');
  await page.selectOption('#destination', { label: 'Other: type a destination for this visit only' });
  await page.fill('#destinationText', 'Roof access');
  await page.click('button[data-intent="submit"]');
  await page.waitForSelector('#dup-title');
  await page.click('#dup-title ~ .table-wrap a.name-link');
  await page.waitForSelector('h1:has-text("Person Record")');
  await menu(page, 'Sign In');
  assert.ok(await page.isVisible('#dup-title'), 'back on the same step');
  await page.click('#back-to-form');
  assert.equal(await page.inputValue('#firstName'), 'James');
  assert.equal(await page.inputValue('#destinationText'), 'Roof access');
  await context.close();
});

test('inside the Claude viewer, printing and exports save files through the downloads capability', async () => {
  const body = readFileSync(new URL('../../dist/stronghold-artifact.html', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'stronghold-viewer-'));
  const file = join(dir, 'viewer.html');
  // The viewer wraps the page in a skeleton and provides window.claude before any script runs.
  const fake = `<script>window.__saved=[];window.claude={use:async(name)=>name==='downloads'?{save:async({filename,data})=>{window.__saved.push({filename,size:String(data).length});return{status:'saved'}}}:null};</script>`;
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8">${fake}</head><body>${body}</body></html>`);
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.fill('#siteName', 'Riverside Civic Center');
  await page.fill('#displayName', 'Dana Whitlock');
  await page.fill('#username', 'dana');
  await page.fill('#password', 'correct horse');
  await page.fill('#confirm', 'correct horse');
  await page.click('text=Create Account and Open Stronghold');
  await page.waitForSelector('h1:has-text("Sign In")');
  await manualEntry(page, { first: 'Jordan', last: 'Ellis', dob: '1990-03-14' });
  await page.waitForSelector('#done-title');
  await page.waitForFunction(() => window.__saved.length === 1);
  assert.match(await page.evaluate(() => window.__saved[0].filename), /^badge-\d{4}-ellis\.html$/);
  assert.match(await page.textContent('.result .alert'), /Open the file to print it/);
  await menu(page, 'Backup');
  await page.click('#download-backup');
  await page.waitForFunction(() => window.__saved.length === 2);
  assert.match(await page.evaluate(() => window.__saved[1].filename), /^stronghold-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await context.close();
});
