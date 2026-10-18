// Text, name and date helpers shared by the service and the pages.

// Collapses runs of whitespace and trims, so "  Ana   Lopez " is stored as "Ana Lopez".
export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// The form of a name used for comparison: no accents, no case, no spaces or punctuation.
// "José-Luis" and "jose luis" compare equal.
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function fullName(p) {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

// "Lopez, Ana", for lists sorted by last name.
export function sortName(p) {
  return `${p.lastName}, ${p.firstName}`;
}

export function compareByName(a, b) {
  return (
    normalizeName(a.lastName).localeCompare(normalizeName(b.lastName)) ||
    normalizeName(a.firstName).localeCompare(normalizeName(b.firstName))
  );
}

// True for a real calendar date written YYYY-MM-DD.
export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// The local calendar date of a Date, as YYYY-MM-DD.
export function localIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Start of a local calendar day (YYYY-MM-DD) as a Date.
export function startOfLocalDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// Start of the local day after the given one, so a range is [start, nextDay).
export function startOfNextLocalDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0);
}

export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

// The words of a text in comparable form. "José-Luis" gives joseluis, jose and luis.
function searchWords(text) {
  return String(text ?? '')
    .split(/[\s,]+/)
    .flatMap((chunk) => [chunk, ...chunk.split(/[-\u2010-\u2014/]+/)])
    .map(normalizeName)
    .filter(Boolean);
}

// The one search rule for every search box: each word typed must start a word of the text.
// "ana lo" finds Ana Lopez; "opez" does not.
export function textQueryMatches(text, query) {
  const tokens = searchWords(query);
  if (!tokens.length) return true;
  const words = searchWords(text);
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

export function nameQueryMatches(person, query) {
  return textQueryMatches([person.firstName, person.lastName, person.company].filter(Boolean).join(' '), query);
}

// A spreadsheet runs a cell that starts with = + - or @ as a formula, so such text gets a leading '.
export function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
