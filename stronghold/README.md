# Stronghold

Visitor management for public sector operations: the front desk of one building signs visitors and contractors in and out, screens each one against a watchlist before admission, prints badges, and keeps a searchable visit history.

This folder is a Playground experiment, not production work: a one-shot build of [SPEC_000](https://github.com/aliaseddd/Stronghold/blob/9dd683e94f87e8b196d7551ac4cb72210dd3c355/specifications/SPEC_000.md) from [aliaseddd/Stronghold](https://github.com/aliaseddd/Stronghold), made outside the Rapture workflow to see what a complete first version looks like. [IMPLEMENTATION.md](IMPLEMENTATION.md) traces every requirement and constraint to the code and tests, and lists the judgment calls.

## Using it

Stronghold is a web app that needs no server and no installation. The whole app, its "backend" included, is one HTML file that runs in the browser and keeps its records in that browser's storage (IndexedDB).

Pick whichever is easiest:

1. **In the Claude viewer.** Open the private artifact at <https://claude.ai/artifact/K528vYfLUUjJvMKod5y9qg>. Everything works there except the print dialog, which the viewer blocks; Print Badge saves the badge as a page that prints when you open it.
2. **On localhost, for real records.** With Node 20 or later, run `npm start` in this folder, then open <http://localhost:8080>. This serves the same file, on this computer only, and printing goes straight to the print dialog.
3. **As a file, for a quick try.** Download [`dist/stronghold.html`](dist/stronghold.html) and open it in Chrome, Edge or Firefox. Browsers let every page opened from disk share storage, so another HTML file opened the same way could read the records; the page says so.

The first screen creates the first account. Leave **Add example records** ticked to get destinations, a watchlist, 13 invented people and three weeks of visits; the Sign In page then suggests things to try (a returning visitor, a watchlist match, a possible match, a contractor). An Administrator can remove the example records in one step on the Backup page.

Records stay in the browser that created them. Another browser, another computer or the Claude viewer each start empty; use **Backup** to move records between them.

## What it does

| Area | Pages |
| --- | --- |
| The desk | **Sign In** (find or enter a person, screen, sign in and print, all on one page) · **Held Sign-Ins** (screening holds waiting for a decision) · **Currently Signed In** (sign out one or many) · **People** and each **Person Record** with visit history and logged corrections · **Sign-In Report** for any date range, with CSV export |
| Administration | **Destinations** · **Watchlist** · **User Accounts** (Operator and Administrator roles) · **Settings** (building name, retention period, watchlist screening) · **Expired Visits** (deletion only after retention) · **Audit Log** · **Backup** |
| Everyone | **My Account** (change password) · **Help** |

Screening compares the first and last name and the date of birth with every watchlist entry. A name and date of birth match, a name-only match, or screening switched off all hold the sign-in; nobody is signed in and no badge prints until a user admits the person with a reason. The decision goes into the Audit Log.

## How it is built

- `src/core/` holds every rule, with no browser code: the service (commands and queries, role checks, audit), screening, sample data, password hashing (PBKDF2 through Web Crypto). Each command stages its changes and commits them in one transaction before the in-memory state changes.
- `src/web/` is the interface: plain JavaScript, no framework. One template function escapes everything it interpolates; one list component, one set of form controls and one dialog are used by every page, which keeps like things alike.
- `scripts/build.mjs` bundles both with esbuild into `dist/stronghold.html` (a complete page) and `dist/stronghold-artifact.html` (the same page for the Claude viewer).
- The page makes no network requests: no fonts, scripts or analytics from anywhere else.

## Developing

Run these from this `stronghold/` folder.

```sh
npm install          # esbuild, for the build
npm test             # unit tests of the core, against the spec's requirements
npm run test:e2e     # builds, then drives the page in headless Chromium (needs Playwright)
npm run build        # rebuilds dist/
npm start            # serves dist/stronghold.html on http://localhost:8080
```

The version number lives in `package.json` and `src/core/version.js`; a test and the build check that they agree.
