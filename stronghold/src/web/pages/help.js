// Help: how Stronghold works, in the desk's words.
import { html, screeningPill } from '../ui.js';
import { printing, inClaudeViewer } from '../env.js';

export const helpPage = {
  id: 'help',
  name: 'Help',
  title: () => 'Help',
  lede: () => 'How Stronghold works, from the desk to the Audit Log.',

  view(ctx) {
    const admin = ctx.user.roles.includes('admin');
    return html`<div class="prose">
      <section>
        <h2>Signing someone in</h2>
        <ol>
          <li>On <a href="#/sign-in">Sign In</a>, choose Visitor or Contractor.</li>
          <li>Type a name and press Find. If the person has been here before, press Select next to the right date of birth; their details are not typed again.</li>
          <li>For a first visit, press Manual Entry and fill in the details marked with *. Contractors also need a company.</li>
          <li>Choose a destination. Other is for a place that is not on the list; it is used for this visit only.</li>
          <li>Press <strong>Submit &amp; Print</strong> to sign in and print a badge, or <strong>Submit</strong> to sign in without one.</li>
        </ol>
        <p>Stronghold never reuses or merges a record by itself. If a new entry has the same name and date of birth as an existing record, it asks which to use.</p>
      </section>
      <section>
        <h2>Screening and held sign-ins</h2>
        <p>Every sign-in is checked against the watchlist before anyone is signed in, and the result is shown first.</p>
        <table class="table table-compact">
          <thead><tr><th scope="col">Result</th><th scope="col">Meaning</th><th scope="col">What happens</th></tr></thead>
          <tbody>
            <tr><td>${screeningPill('no match')}</td><td>No watchlist entry has the name.</td><td>The person is signed in.</td></tr>
            <tr><td>${screeningPill('possible match')}</td><td>An entry has the name but a different date of birth.</td><td>The sign-in is held.</td></tr>
            <tr><td>${screeningPill('match')}</td><td>An entry has the name and the date of birth.</td><td>The sign-in is held.</td></tr>
            <tr><td>${screeningPill('not run')}</td><td>Watchlist screening is switched off in Settings.</td><td>The sign-in is held.</td></tr>
          </tbody>
        </table>
        <p>A held sign-in waits on <a href="#/held">Held Sign-Ins</a>. Any logged-in user can admit or refuse, giving a reason. Nobody is signed in and no badge prints until someone admits. The decision goes into the Audit Log with the matching entries.</p>
      </section>
      <section>
        <h2>Badges</h2>
        <p>A badge shows the name, person type, company, destination, sign-in time and visit number. It never shows a date of birth or a screening result. Badges print only for people who are signed in; to print one again, use Print Badge on Currently Signed In or on the person's record.</p>
        <p>${
          inClaudeViewer
            ? printing.note
            : 'Printing uses the browser print dialog and any ordinary printer. The badge prints at 3.75 by 2.5 inches with a dashed edge to cut along. A sign-in is recorded before the badge prints, so a printer problem never undoes it.'
        }</p>
      </section>
      <section>
        <h2>Signing out and corrections</h2>
        <p>Sign people out on <a href="#/present">Currently Signed In</a>, one at a time or several at once. If a time was recorded wrongly, use Correct on the person's visit history. Every correction needs a reason${admin ? html` and appears in the <a href="#/audit">Audit Log</a>` : ' and is kept in the Audit Log'}.</p>
      </section>
      <section>
        <h2>Roles</h2>
        <p>Operators work the desk: Sign In, Currently Signed In, People and the Sign-In Report. Administrators keep the destinations, the watchlist, accounts and settings, delete expired visits and read the Audit Log. An account can hold both roles. Every logged-in user can decide a held sign-in.</p>
      </section>
      <section>
        <h2>Where records are kept</h2>
        <p>Records stay in this browser on this computer; nothing is sent to a server. ${admin ? html`Download a backup regularly from <a href="#/backup">Backup</a>.` : 'An Administrator downloads backups from the Backup page.'} Visits are kept until the retention period set in Settings has passed, and then only an Administrator can delete them.</p>
      </section>
    </div>`;
  },

  actions: {},
};
