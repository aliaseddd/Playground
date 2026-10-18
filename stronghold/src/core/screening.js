// Screening of a person against the watchlist (REQ_000_012 to REQ_000_016).
import { normalizeName } from './text.js';

export const MATCH = 'match';
export const POSSIBLE_MATCH = 'possible match';
export const NO_MATCH = 'no match';
export const NOT_RUN = 'not run';

export const OUTCOMES = [NO_MATCH, POSSIBLE_MATCH, MATCH, NOT_RUN];

// Names match when the first and last names are the same once capitals, accents, spaces and
// punctuation are ignored. A first and last name entered the wrong way round also match.
export function nameMatches(person, entry) {
  const pf = normalizeName(person.firstName);
  const pl = normalizeName(person.lastName);
  const ef = normalizeName(entry.firstName);
  const el = normalizeName(entry.lastName);
  if (!pf || !pl || !ef || !el) return false;
  return (pf === ef && pl === el) || (pf === el && pl === ef);
}

// Returns { outcome, matches, cause }. `matches` holds every entry whose name matches, each
// marked with whether its date of birth matches too. `cause` explains a "not run" outcome.
export function screenPerson(person, watchlist, availability) {
  if (!availability.available) {
    return { outcome: NOT_RUN, matches: [], cause: availability.cause };
  }
  const matches = watchlist
    .filter((entry) => nameMatches(person, entry))
    .map((entry) => ({
      id: entry.id,
      firstName: entry.firstName,
      lastName: entry.lastName,
      dob: entry.dob,
      dobMatches: entry.dob === person.dob,
    }));
  if (matches.some((m) => m.dobMatches)) return { outcome: MATCH, matches, cause: null };
  if (matches.length) return { outcome: POSSIBLE_MATCH, matches, cause: null };
  return { outcome: NO_MATCH, matches: [], cause: null };
}

// The sentence shown to the desk when a sign-in is held (REQ_000_019).
export function holdReason(outcome, cause) {
  switch (outcome) {
    case MATCH:
      return 'The name and date of birth match a watchlist entry.';
    case POSSIBLE_MATCH:
      return 'The name matches a watchlist entry, but the date of birth does not. This may be a different person.';
    case NOT_RUN:
      return `Screening could not run: ${cause || 'the watchlist is not available'}. Nobody has checked this person against the watchlist.`;
    default:
      return '';
  }
}
