# How this build implements SPEC_000

Stronghold 0.1.0 was built in one pass from [SPEC_000](https://github.com/aliaseddd/Stronghold/blob/9dd683e94f87e8b196d7551ac4cb72210dd3c355/specifications/SPEC_000.md), the [initiation questionnaire](https://github.com/aliaseddd/Stronghold/blob/9dd683e94f87e8b196d7551ac4cb72210dd3c355/initiation-questionnaire.md) (both as of Stronghold commit 9dd683e) and the Raptor walkthrough notes. Raptor was the reference for features and flows only; no code or data came from it (CON_000_010).

## Decisions

**The backend runs in the browser.** The brief was a web app used from a browser, with no production deployment and no hosting on an intranet. So there is no server: the domain logic (`src/core/service.js`) runs in the page, and records live in the browser's IndexedDB. This meets CON_000_002 (no paid or recurring service) and CON_000_003 (personal data never leaves the desk computer) by construction, and starting it is opening one file (CON_000_008).

*Cost of this choice:* records belong to one browser profile on one computer, and the login is enforced by the app, not by a server. Anyone with the browser's developer tools on that computer could read the stored records. Opened straight from disk (`file://`), the page shares storage with every other page opened from disk, so that way is labelled as for trying only; `npm start` serves it from its own origin. A real deployment for more than one desk needs a server and a shared database; the service layer is written against a small store interface (`load`, `commit`, `replaceAll`) so it can move behind one.

**Each command is one transaction, and one tab writes at a time.** A command takes a browser-wide write lock (Web Locks), reloads the records if another tab has committed since (each commit stamps a new revision), checks the account, role and rules against that, stages every change, commits them in one IndexedDB transaction with strict durability, and only then updates memory. So two tabs cannot both sign in the same person or hand out the same visit number (REQ_000_010), a failed write leaves nothing half done, and a reload or crash keeps every committed record (REQ_000_040).

**Screening is two steps, so the desk sees the result before anything is recorded.** `screenSignIn` validates and screens without writing. The page shows the result, then calls `commitSignIn` with the outcome it showed. If the watchlist changed in between, the service records nothing and returns the new result to show first (REQ_000_017).

**A hold is a record, not a screen state.** A held sign-in is saved and listed on Held Sign-Ins, open to every user, so it survives a reload and a supervisor can decide from their own login (REQ_000_019, REQ_000_020). When the person is admitted, the visit records the Operator who submitted the sign-in as signing them in (REQ_000_007); the person who decided is in the Audit Log (REQ_000_021).

**"The watchlist is not available" means screening is switched off in Settings.** The spec says what happens when the watchlist is unavailable but not what makes it so. With no server and no external registry, the one honest cause is an Administrator switching screening off, for example while rebuilding the list. Every sign-in is then held as "not run" (REQ_000_013).

**Printing uses the browser.** A badge is a 3.75 × 2.5 inch card printed through the browser's print dialog on any printer (CON_000_007). The visit is recorded before the print starts, so a printer problem never undoes a sign-in (REQ_000_024). The Claude viewer blocks print dialogs, so there Print Badge saves the badge as a page that prints when opened.

## Judgment calls

These go beyond what the spec says, or bend it. Each is easy to reverse.

- **Removing example records.** Example records are invented, so an Administrator can delete them in one step before real use. This is the one removal of visits other than the retention deletion in REQ_000_039. It touches only visits the example set created, asks for confirmation and a reason, and is logged.
- **Restore only into a new installation.** A backup restore replaces records, so it is offered only where nothing has been recorded beyond setup: no person, visit or hold, and no Audit Log entry other than setup. Restore can therefore never remove a recorded visit or bring back a deleted record (REQ_000_039), and the installation's own Audit Log entries are kept after the backup's (REQ_000_036).
- **Deleting a person record.** An Administrator may delete a person who has no visits left, and Expired Visits can delete the people its deletions leave without visits. This serves CON_000_005 (least personal data). Each deletion is logged without the person's details (REQ_000_036).
- **The Audit Log names records, not people.** Corrections, person changes, watchlist changes and deletions refer to records by number or identifier and list the fields that changed, so no name or date of birth outlives a retention deletion (CON_000_005). Decisions are the exception: REQ_000_021 requires their name and date of birth.
- **Retention defaults to 365 days.** The questionnaire left the default open (IPQ-24).
- **Corrections are open to every user.** REQ_000_035 asks that a change to a sign-in or sign-out be logged with who, when and why; it does not limit who. Every correction needs a reason.
- **CSV export of the report.** The questionnaire prefers it (IPQ-12). The file leaves the system, so the page says it holds personal details.
- **Name matching.** Names match after removing capitals, accents, spaces and punctuation, and also when first and last name are swapped. There is no nickname or sound-alike matching, so screening stays predictable.
- **Searches stay within a person type.** Find searches the chosen type, as Raptor does, but says when people of the other type also match and offers to show them, so nobody is hidden.

## Not built

Photo capture and ID type and number (no requirement uses them, CON_000_005), notes, kiosks, students, staff and volunteers, auto sign-out at a set time, session timeout, a printer status page, multiple buildings, scheduled reports, and screening against an external registry.

## Requirements

Unit tests are in `test/core/service.test.mjs`; browser tests are in `test/e2e/desk.test.mjs`.

| Statement | Where | Tested by |
| --- | --- | --- |
| REQ_000_001 Returning person signed in without re-entry | `findPeople`, Sign In: Find and Select | unit "a returning person…", e2e "a returning visitor…" |
| REQ_000_002 New person signed in by entry | Sign In: Manual Entry | unit "a new visitor…", e2e "a new visitor…" |
| REQ_000_003 Person type | Sign In: Visitor / Contractor choice; Edit Details | e2e "a returning visitor…" |
| REQ_000_004 Contractor's company | `_validatePersonDetails` | unit "a contractor keeps their company" |
| REQ_000_005 One-screen sign-in | Sign In page, `screenAndCommit` | e2e "a new visitor…" (address unchanged) |
| REQ_000_006 Sign-out from the presence list | Currently Signed In: Sign Out | e2e "a new visitor…" |
| REQ_000_007 What a sign-in records | `_admit` | unit "a new visitor…", "an admitted hold records the Operator who submitted it…" |
| REQ_000_008 What a sign-out records | `signOut` | unit "sign-out records time and operator…" |
| REQ_000_009 Person records kept | `_admit` | unit "a new visitor…" |
| REQ_000_010 Signed in at most once | `_checkNotPresent` under the write lock; Select disabled with reason | unit "a person already signed in…", "two copies writing to one store…", e2e "two tabs signing in the same person…" |
| REQ_000_011 Presence list is exact | `presentList` (derived from open visits) | unit "a new visitor…", e2e "a new visitor…" |
| REQ_000_012 Every sign-in screened | `screenSignIn`, `commitSignIn` | unit tests of each outcome |
| REQ_000_013 Outcome not run | `_availability` | unit "screening switched off…" |
| REQ_000_014 Outcome match | `screenPerson` | unit "a name and date of birth match…" |
| REQ_000_015 Outcome possible match | `screenPerson` | unit "a name-only match…" |
| REQ_000_016 Outcome no match | `screenPerson` | unit "a new visitor…" |
| REQ_000_017 Result shown before admission | two-step sign-in | unit "the result shown is the result acted on…" |
| REQ_000_018 Admission | `commitSignIn`, `decideHold` | unit "a new visitor…", "any user may admit…" |
| REQ_000_019 Hold until decided, saying why | `holdReason`, hold panel | unit "a name and date of birth match…", e2e "a watchlist match…" |
| REQ_000_020 Any user decides a hold | `decideHold` (any active account), Held Sign-Ins for all | unit "any user may admit…" |
| REQ_000_021 Decisions logged | `decideHold` audit entry | unit "any user may admit…", e2e "a watchlist match…" |
| REQ_000_022 Badge printing | Print Badge on Sign In, Currently Signed In, Person Record | e2e "a new visitor…" |
| REQ_000_023 No badge without a sign-in | `badge`, `whyNoBadge` | unit "sign-out records time…", e2e "a watchlist match…" |
| REQ_000_024 Sign-in never waits on the printer | `print.js`: print after the visit is recorded | e2e "a new visitor…" |
| REQ_000_025 Record and history from any list | name links in every list open the Person Record | e2e tours |
| REQ_000_026 Sign-in report | `report`, Sign-In Report | unit "the report holds exactly…", e2e "a new visitor…" |
| REQ_000_027 No merge or reuse the user did not choose | `_duplicates`, "Use This Record" / "Create a New Record" | unit "an entry matching an existing record…", e2e "a returning visitor…" |
| REQ_000_028 Administrator maintains destinations | Destinations page | unit "destination names stay unique" |
| REQ_000_029 Administrator maintains the watchlist | Watchlist page | unit "removals and deletions are logged…" |
| REQ_000_030 Administrator maintains user accounts | User Accounts page | unit "login checks the password…", e2e "an Operator sees only…" |
| REQ_000_031 Administrator sets the retention period | Settings page | unit "the retention period is set by an Administrator…" |
| REQ_000_032 Login required | `App.route`; every service call checks the account | e2e "an Operator sees only…" |
| REQ_000_033 Operator and Administrator roles | `ROLES`, User Accounts | unit "the first account gets both roles…" |
| REQ_000_034 Maintenance only by the Administrator | role checks in the service, not only the menu | unit "only Administrators change…" |
| REQ_000_035 Recorded history never silently altered | `correctVisit` | unit "a correction needs a reason…" |
| REQ_000_036 Deletions logged | `deletion` audit entries; restore keeps existing entries | unit "removals and deletions are logged…", "restoring into a set-up installation keeps its Audit Log entries" |
| REQ_000_037 Audit log readable | Audit Log page | e2e "a watchlist match…" |
| REQ_000_038 Expired visits deleted by the Administrator | Expired Visits page, `deleteExpiredVisits` | unit "only visits past the retention period…" |
| REQ_000_039 Visits removed only after retention | no other delete path; restore only into a new installation | unit "only visits past…", "restore is refused once anything has been recorded…" (see Judgment calls) |
| REQ_000_040 Records survive restarts and crashes | atomic IndexedDB transactions | unit "a failed write…", "records survive reopening…", e2e "records survive a reload…" |
| REQ_000_041 Unavailable controls say why | `button({ why })` shows the reason beside every disabled control | e2e "every page names itself…" |
| REQ_000_042 Every page names itself | page heading = menu label | e2e "every page names itself…" |
| REQ_000_043 Every page reachable from the menu | `MENU` in `app.js` | e2e "every page names itself…", "an Operator sees only…" |
| REQ_000_044 Same label, same action | one `button` helper; labels used for one action each | review |
| REQ_000_045 Like lists behave alike | one `listView`: loads everything, filters as you type, names open records; one search rule, `textQueryMatches`, for Find and every list | unit "find on Sign In and the search box on lists match the same way" |
| REQ_000_046 One visual style | one stylesheet, `src/web/styles.css` | review |
| REQ_000_047 One version number | `APP_VERSION` in the footer of every page | unit "every page shows the version…", e2e "every page names itself…" |
| REQ_000_048 Empty lists say so | `listView` empty sentence | e2e "every page names itself…" |
| REQ_000_049 Required details marked | `*` on every required field, legend on every form | review |
| REQ_000_050 Missing details stop the action and are named | `requireFilled`, error summary | unit "missing details are named…", e2e "a watchlist match…" |
| REQ_000_051 Confirmation before bulk or destructive actions | `openDialog` for multi sign-out, removals, deletions, restore, disabling an account | e2e "records survive a reload, and several people sign out…" |

## Constraints

| Constraint | How it is met |
| --- | --- |
| CON_000_001 No language model at runtime | None in the code. |
| CON_000_002 No paid or recurring service | No server and no external service. |
| CON_000_003 Personal data stays with the desk | Stored only in the browser; the page makes no network requests. Backups and CSV exports are files the user chooses to save. |
| CON_000_004 No screening result on a badge | `badge()` returns no screening field; e2e checks the printed page. |
| CON_000_005 Least personal data | Stores name, date of birth, type, company (contractors), visit times and destination. No ID numbers, photos or notes. Audit entries outside decisions carry identifiers, not names (unit "audit entries outside decisions name records by number or id…"). |
| CON_000_006 Desktop browser interface | A web page; also usable at phone width. |
| CON_000_007 Ordinary desk hardware | Browser printing to any printer. |
| CON_000_008 One command to start | Open `dist/stronghold.html`, or `npm start`. |
| CON_000_009 No hand-edited data files | Every record is created through the pages. |
| CON_000_010 Nothing taken from Raptor | Written from the spec; the notes were read for flows only. |
