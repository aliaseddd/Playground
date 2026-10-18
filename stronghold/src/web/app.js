// Starts Stronghold in the browser: opens storage, restores the session, routes between pages
// and draws the menu. Every page is reached from the menu (REQ_000_043), names itself in its
// heading (REQ_000_042) and shows the same version in the footer (REQ_000_047).
import { Service } from '../core/service.js';
import { MemoryStore } from '../core/memory-store.js';
import { APP_VERSION } from '../core/version.js';
import { IndexedDBStore } from './idb-store.js';
import { html, toHtml, attrs, alertBox, ROLE_LABELS } from './ui.js';
import { mountPage } from './page.js';
import { sessionStore, inClaudeViewer, FILE_MODE_NOTE, writeLock } from './env.js';
import { BADGE_CSS } from './badge.js';

import { setupPage } from './pages/setup.js';
import { loginPage } from './pages/login.js';
import { signInPage } from './pages/sign-in.js';
import { heldPage } from './pages/held.js';
import { presentPage } from './pages/present.js';
import { peoplePage } from './pages/people.js';
import { personPage } from './pages/person.js';
import { reportPage } from './pages/report.js';
import { destinationsPage } from './pages/destinations.js';
import { watchlistPage } from './pages/watchlist.js';
import { accountsPage } from './pages/accounts.js';
import { settingsPage } from './pages/settings.js';
import { expiredPage } from './pages/expired.js';
import { auditPage } from './pages/audit.js';
import { backupPage } from './pages/backup.js';
import { myAccountPage } from './pages/my-account.js';
import { helpPage } from './pages/help.js';

const SESSION_KEY = 'stronghold.session';

// The menu, in order. `roles` lists who may open the page; null means every logged-in user.
const MENU = [
  {
    group: 'Desk',
    items: [
      { path: 'sign-in', page: signInPage, roles: ['operator'] },
      { path: 'held', page: heldPage, roles: null, count: 'held' },
      { path: 'present', page: presentPage, roles: ['operator'], count: 'present' },
      { path: 'people', page: peoplePage, roles: ['operator'] },
      { path: 'report', page: reportPage, roles: ['operator'] },
    ],
  },
  {
    group: 'Administration',
    items: [
      { path: 'destinations', page: destinationsPage, roles: ['admin'] },
      { path: 'watchlist', page: watchlistPage, roles: ['admin'] },
      { path: 'accounts', page: accountsPage, roles: ['admin'] },
      { path: 'settings', page: settingsPage, roles: ['admin'] },
      { path: 'expired', page: expiredPage, roles: ['admin'] },
      { path: 'audit', page: auditPage, roles: ['admin'] },
      { path: 'backup', page: backupPage, roles: ['admin'] },
    ],
  },
  {
    group: 'Account',
    items: [
      { path: 'my-account', page: myAccountPage, roles: null },
      { path: 'help', page: helpPage, roles: null },
    ],
  },
];

// Pages reached from a menu page rather than listed in the menu themselves.
const SUBPAGES = {
  people: { page: personPage, roles: ['operator'], parent: 'people' },
  held: { page: heldPage, roles: null, parent: 'held' },
  'sign-in': { page: signInPage, roles: ['operator'], parent: 'sign-in' },
};

const ROUTES = Object.fromEntries(MENU.flatMap((g) => g.items.map((i) => [i.path, i])));

class App {
  constructor(root) {
    this.root = root;
    this.user = null;
    this.flash = null;
    this.current = null;
    this.path = '';
    this.storageWarning = null;
    this.menuOpen = false;
    this.pageStates = {};
    // Opened from disk, the records share storage with every other page opened from disk.
    this.fileMode = typeof location !== 'undefined' && location.protocol === 'file:';
  }

  async start() {
    this.drawMessage('Opening Stronghold…');
    let store;
    try {
      store = await IndexedDBStore.open();
    } catch (e) {
      this.drawStorageProblem(e);
      return;
    }
    await this.boot(store);
  }

  async boot(store) {
    this.svc = await Service.open(store, { lock: writeLock });
    try {
      this.channel = new BroadcastChannel('stronghold');
      this.channel.onmessage = () => this.svc.reload('remote');
    } catch {
      this.channel = null;
    }
    this.svc.onChange((origin) => this.dataChanged(origin));
    const saved = sessionStore.get(SESSION_KEY);
    if (saved && saved.userId) this.user = this.svc.sessionUser(saved.userId);
    const followAddress = () => {
      const path = location.hash.replace(/^#\/?/, '');
      if (path === this.path) return;
      this.path = path;
      this.route();
    };
    window.addEventListener('hashchange', followAddress);
    window.addEventListener('popstate', followAddress);
    this.path = location.hash.replace(/^#\/?/, '');
    this.root.addEventListener('click', (e) => this.shellClick(e));
    this.route();
  }

  // ---------------------------------------------------------------- session

  logIn(user) {
    this.user = user;
    this.pageStates = {};
    if (this.svc.store.protect) this.svc.store.protect().catch(() => {});
    sessionStore.set(SESSION_KEY, { userId: user.id });
    this.go(this.homePath());
  }

  logOut(message = null) {
    this.user = null;
    this.pageStates = {};
    sessionStore.remove(SESSION_KEY);
    if (message) this.flash = { kind: 'info', title: message };
    this.go('');
  }

  endSession(message) {
    this.logOut(message);
  }

  takeFlash() {
    const f = this.flash;
    this.flash = null;
    return f;
  }

  can(roles) {
    return Boolean(this.user) && (!roles || roles.some((r) => this.user.roles.includes(r)));
  }

  homePath() {
    return this.can(['operator']) ? 'sign-in' : 'held';
  }

  // ---------------------------------------------------------------- routing

  // Moves to a page. The address is updated with pushState, so no hashchange follows.
  go(path, { flash = null } = {}) {
    if (flash) this.flash = flash;
    this.path = path;
    try {
      if (location.hash !== `#/${path}`) history.pushState(null, '', `#/${path}`);
    } catch {
      /* this view does not allow changing the address; route in place */
    }
    this.route();
  }

  route() {
    this.menuOpen = false;
    if (!this.svc.isSetUp()) return this.showBare(setupPage);
    if (!this.user) return this.showBare(loginPage);
    const [head, id] = this.path.split('/');
    let entry = ROUTES[head];
    let params = {};
    if (entry && id && SUBPAGES[head]) {
      entry = { ...SUBPAGES[head], path: head };
      params = { id: decodeURIComponent(id) };
    }
    if (!entry) {
      this.path = this.homePath();
      try {
        history.replaceState(null, '', `#/${this.path}`);
      } catch {
        /* address cannot change here */
      }
      entry = ROUTES[this.path];
    }
    if (!this.can(entry.roles)) return this.showUnavailable(entry);
    this.showPage(entry.page, params, entry.roles);
  }

  // ---------------------------------------------------------------- drawing

  frame(content, { withMenu }) {
    const settings = this.svc ? this.svc.settings() : {};
    return html`
      <a class="skip" href="#main" data-skip>Skip to page content</a>
      <div class="shell${withMenu ? '' : ' shell-bare'}${this.menuOpen ? ' menu-open' : ''}">
        ${withMenu ? this.rail(settings) : html`<header class="bare-head"><span class="wordmark">Stronghold</span>${settings.siteName ? html`<span class="site">${settings.siteName}</span>` : ''}</header>`}
        <main id="main" tabindex="-1">
          ${this.storageWarning ? alertBox('warn', 'Records are not being saved', this.storageWarning) : ''}
          ${this.fileMode && !withMenu ? alertBox('warn', 'Opened as a file: for trying Stronghold only', FILE_MODE_NOTE) : ''}
          <div id="page-slot"></div>
        </main>
        <footer class="foot">
          <span>Stronghold <span class="version">v${APP_VERSION}</span></span>
          <span>${this.storeLabel()}</span>
        </footer>
      </div>`;
  }

  storeLabel() {
    if (!this.svc) return '';
    const d = this.svc.describeStore();
    if (d.kind === 'memory') return 'Records are kept in memory only';
    if (this.fileMode) return 'Opened as a file: for trying only, not for real records';
    return inClaudeViewer ? 'Records are kept in this browser, inside the Claude viewer' : 'Records are kept in this browser on this computer';
  }

  rail(settings) {
    const stats = this.svc.stats(this.user.id);
    const active = this.path.split('/')[0];
    return html`<aside class="rail" aria-label="Stronghold">
      <div class="brand">
        <span class="wordmark">Stronghold</span>
        <span class="site">${settings.siteName}</span>
        <button type="button" class="menu-toggle" data-menu-toggle aria-expanded="${this.menuOpen ? 'true' : 'false'}" aria-controls="menu">Menu</button>
      </div>
      <nav id="menu" aria-label="Main menu">
        ${MENU.map((g) => {
          const items = g.items.filter((i) => this.can(i.roles));
          if (!items.length) return '';
          return html`<div class="menu-group"><p class="menu-label">${g.group}</p><ul>
            ${items.map((i) => {
              const count = i.count ? stats[i.count] : null;
              return html`<li><a ${attrs({ href: `#/${i.path}`, class: `menu-link${active === i.path ? ' is-active' : ''}`, 'aria-current': active === i.path ? 'page' : null })}>
                <span>${i.page.menuLabel || i.page.name}</span>
                ${count ? html`<span class="count${i.count === 'held' ? ' count-warn' : ''}" aria-label="${count} ${i.count === 'held' ? 'held' : 'signed in'}">${count}</span>` : ''}
              </a></li>`;
            })}
          </ul></div>`;
        })}
      </nav>
      <div class="rail-user">
        <span class="who">${this.user.displayName}</span>
        <span class="who-meta">${this.user.username} · ${this.user.roles.map((r) => ROLE_LABELS[r]).join(', ')}</span>
        <button type="button" class="btn btn-rail" data-logout>Log Out</button>
      </div>
    </aside>`;
  }

  mount(page, params, withMenu) {
    this.root.innerHTML = toHtml(this.frame('', { withMenu }));
    const ctx = mountPage(this, page, params);
    this.current = ctx;
    this.root.querySelector('#page-slot').replaceWith(ctx.root);
    document.title = `${page.title(ctx)} · Stronghold`;
    window.scrollTo(0, 0);
    const h1 = ctx.root.querySelector('h1');
    if (h1 && !ctx.root.contains(document.activeElement)) h1.focus({ preventScroll: true });
    return ctx;
  }

  showPage(page, params, roles) {
    this.currentRoles = roles;
    this.mount(page, params, true);
  }

  showBare(page) {
    this.currentRoles = null;
    this.mount(page, {}, false);
  }

  showUnavailable(entry) {
    this.currentRoles = null;
    const page = {
      id: 'unavailable',
      name: 'Page Not Available',
      title: () => 'Page Not Available',
      view: () =>
        html`<section class="panel"><p>${entry.page.name} is for ${entry.roles.map((r) => ROLE_LABELS[r]).join(' or ')} accounts. You are logged in as ${this.user.username}, which has the ${this.user.roles.map((r) => ROLE_LABELS[r]).join(' and ')} ${this.user.roles.length === 1 ? 'role' : 'roles'}.</p>
          <p><a href="#/${this.homePath()}">Go to ${ROUTES[this.homePath()].page.name}</a></p></section>`,
    };
    this.mount(page, {}, true);
  }

  // Redraws the menu, for counts and names that changed.
  redrawRail() {
    const rail = this.root.querySelector('.rail');
    if (!rail || !this.user) return;
    const holder = document.createElement('div');
    holder.innerHTML = toHtml(this.rail(this.svc.settings()));
    rail.replaceWith(holder.firstElementChild);
  }

  dataChanged(origin) {
    if (origin === 'local' && this.channel) {
      try {
        this.channel.postMessage('changed');
      } catch {
        /* other tabs refresh when they next act */
      }
    }
    if (!this.svc.isSetUp()) return this.route();
    if (this.user) {
      const fresh = this.svc.sessionUser(this.user.id);
      if (!fresh) return this.endSession('Your account was disabled, so you have been logged out.');
      this.user = fresh;
      if (this.currentRoles && !this.can(this.currentRoles)) return this.route();
      this.redrawRail();
      if (origin === 'remote' && this.current && this.current.page.liveRefresh && !this.current.busy) this.current.render();
    } else if (origin === 'remote' && this.current && this.current.page.id === 'setup' && this.svc.isSetUp()) {
      this.route();
    }
  }

  shellClick(e) {
    if (e.target.closest('[data-logout]')) {
      e.preventDefault();
      this.logOut('You have logged out.');
      return;
    }
    if (e.target.closest('[data-menu-toggle]')) {
      e.preventDefault();
      this.menuOpen = !this.menuOpen;
      this.root.querySelector('.shell').classList.toggle('menu-open', this.menuOpen);
      e.target.closest('[data-menu-toggle]').setAttribute('aria-expanded', String(this.menuOpen));
      return;
    }
    if (e.target.closest('[data-skip]')) {
      e.preventDefault();
      const main = this.root.querySelector('#main');
      if (main) main.focus();
      return;
    }
    const link = e.target.closest('a[href^="#/"]');
    if (link && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      this.go(link.getAttribute('href').slice(2));
    }
  }

  drawMessage(text) {
    this.root.innerHTML = toHtml(html`<div class="boot"><span class="wordmark">Stronghold</span><p>${text}</p></div>`);
  }

  drawStorageProblem(error) {
    this.root.innerHTML = toHtml(html`<div class="boot boot-problem">
      <span class="wordmark">Stronghold</span>
      <h1>Storage Unavailable</h1>
      <p>Stronghold keeps its records in this browser, but the browser did not allow it: ${error.message}</p>
      <p>This happens in private windows and when a browser blocks site data. Open Stronghold in a normal window to keep records. You can also try it now with records kept only until this page is closed.</p>
      <button type="button" class="btn btn-primary" data-memory>Try without saving</button>
    </div>`);
    this.root.querySelector('[data-memory]').addEventListener('click', async () => {
      this.storageWarning = 'This browser blocked storage, so every record is lost when this page is closed or reloaded.';
      await this.boot(new MemoryStore());
    });
  }
}

export function start(root) {
  const style = document.createElement('style');
  style.textContent = BADGE_CSS;
  document.head.append(style);
  const app = new App(root);
  window.__stronghold = app;
  app.start().catch((e) => {
    console.error(e);
    root.innerHTML = toHtml(html`<div class="boot boot-problem"><span class="wordmark">Stronghold</span><h1>Stronghold Could Not Start</h1><p>${e.message}</p></div>`);
  });
}
