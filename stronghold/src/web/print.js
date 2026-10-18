// Printing a badge for an open visit. The visit is already recorded when this runs, so whatever
// happens to the print, the sign-in stands (REQ_000_024); the result says what happened.
import { badgeDocument, badgeFilename } from './badge.js';
import { printDocument, printing } from './env.js';

export async function printBadge(svc, userId, visitId) {
  let badge;
  try {
    badge = svc.badge(userId, visitId);
  } catch (e) {
    return { ok: false, text: `No badge was printed: ${e.message}` };
  }
  const name = badgeFilename(badge);
  try {
    const result = await printDocument(badgeDocument(badge, { autoPrint: printing.mode === 'file' }), name);
    if (result === 'declined') {
      return { ok: false, text: 'The badge was not saved because the save was cancelled. The sign-in is recorded. Use Print Badge to try again.' };
    }
    return {
      ok: true,
      text: printing.mode === 'file' ? `Badge saved as ${name}. Open the file to print it.` : 'Badge sent to the print dialog. If it did not come out, use Print Badge to print it again.',
    };
  } catch (e) {
    return { ok: false, text: `The badge did not print: ${e.message} The sign-in is recorded. Use Print Badge to try again.` };
  }
}

// Lets a page print just after it has drawn the result, so the screen updates first.
export function afterPaint(fn) {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(() => resolve(fn()), 30));
  });
}
