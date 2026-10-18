// The visitor badge, on screen and on paper. It carries the person's name, type, company,
// destination, the sign-in date and time, and the visit number. It never carries a screening
// result (CON_000_004) or a date of birth.
import { html, toHtml, fmt, TYPE_LABELS, esc } from './ui.js';

// Shared by the page (on-screen preview) and the printed document, so both look the same.
export const BADGE_CSS = `
.badge{--band:#0d6b7c;width:3.75in;height:2.5in;box-sizing:border-box;border:1px solid #9aa4ad;border-radius:.12in;
  background:#fff;color:#111;display:grid;grid-template-rows:auto 1fr auto;overflow:hidden;
  font-family:"Bahnschrift","DIN Alternate","Segoe UI",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.badge.badge-contractor{--band:#a3561a}
.badge-band{background:var(--band);color:#fff;display:flex;justify-content:space-between;align-items:baseline;padding:.09in .16in .07in}
.badge-type{font-size:.34in;font-weight:700;letter-spacing:.06em;line-height:1;text-transform:uppercase}
.badge-no{font-size:.13in;letter-spacing:.04em;font-variant-numeric:tabular-nums}
.badge-main{padding:.1in .16in 0;display:flex;flex-direction:column;gap:.02in;min-width:0}
.badge-site{font-size:.12in;text-transform:uppercase;letter-spacing:.08em;color:#4b5560}
.badge-name{font-size:.3in;font-weight:700;line-height:1.05;overflow-wrap:anywhere}
.badge-company{font-size:.16in;color:#26313b}
.badge-foot{display:grid;grid-template-columns:1.4fr 1fr;gap:.1in;padding:.06in .16in .12in;border-top:1px solid #d5dbe0;font-size:.13in}
.badge-foot dt{font-size:.09in;text-transform:uppercase;letter-spacing:.08em;color:#5c6670;margin:0}
.badge-foot dd{margin:0;font-weight:600;overflow-wrap:anywhere}
`;

export function badgeMarkup(b) {
  return html`<div class="badge badge-${b.type}" aria-label="Badge preview">
    <div class="badge-band"><span class="badge-type">${TYPE_LABELS[b.type]}</span><span class="badge-no">No. ${fmt.visitNo(b.number)}</span></div>
    <div class="badge-main">
      <span class="badge-site">${b.siteName}</span>
      <span class="badge-name">${b.firstName} ${b.lastName}</span>
      ${b.company ? html`<span class="badge-company">${b.company}</span>` : ''}
    </div>
    <dl class="badge-foot">
      <div><dt>Destination</dt><dd>${b.destination}</dd></div>
      <div><dt>Signed in</dt><dd>${fmt.date(b.signInAt)} · ${fmt.time(b.signInAt)}</dd></div>
    </dl>
  </div>`;
}

// A complete printable page. `autoPrint` adds a script that opens the print dialog on load,
// for a badge saved as a file.
export function badgeDocument(b, { autoPrint = false } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Badge ${esc(fmt.visitNo(b.number))} - ${esc(b.firstName)} ${esc(b.lastName)}</title>
<style>
@page{margin:.5in}
html,body{margin:0;background:#fff}
.sheet{display:flex;flex-direction:column;align-items:flex-start;gap:.15in}
.cut{font:10px system-ui,sans-serif;color:#777}
${BADGE_CSS}
.badge{border-style:dashed}
</style></head>
<body><div class="sheet">${toHtml(badgeMarkup(b))}<p class="cut">Cut along the dashed line. Wear the badge where it can be seen. Return it at the desk when you leave.</p></div>
${autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},250)})</script>' : ''}
</body></html>`;
}

export function badgeFilename(b) {
  return `badge-${fmt.visitNo(b.number)}-${`${b.lastName}`.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.html`;
}
