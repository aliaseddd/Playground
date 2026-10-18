// Example records offered at setup, so a new installation can be tried straight away.
// Every name here is invented. Visits are placed relative to the current time.

const DESTINATIONS = [
  'Main Office',
  'Building Services',
  'Council Chambers',
  'Finance, 2nd Floor',
  'Planning & Permits',
  'Records Room',
];

const WATCHLIST = [
  { firstName: 'Marcus', lastName: 'Reed', dob: '1985-07-22' },
  { firstName: 'Dana', lastName: 'Whitfield', dob: '1990-11-03' },
  { firstName: 'Victor', lastName: 'Lang', dob: '1972-02-17' },
  { firstName: 'Roberta', lastName: 'Kain', dob: '1968-09-30' },
];

const RECENT_PEOPLE = [
  { type: 'visitor', firstName: 'Ana', lastName: 'Lopez', dob: '1988-04-12' },
  { type: 'visitor', firstName: 'James', lastName: 'Whitaker', dob: '1975-01-30' },
  { type: 'visitor', firstName: 'Priya', lastName: 'Raman', dob: '1992-08-19' },
  { type: 'visitor', firstName: 'Thomas', lastName: 'Brandt', dob: '1960-12-05' },
  { type: 'visitor', firstName: 'Grace', lastName: 'Kim', dob: '1983-03-27' },
  { type: 'visitor', firstName: 'Daniel', lastName: 'Osei', dob: '1979-06-14' },
  { type: 'visitor', firstName: 'Helen', lastName: 'Murphy', dob: '1955-10-08' },
  { type: 'contractor', firstName: 'Samuel', lastName: 'Okafor', dob: '1986-09-23', company: 'Brightline Electrical' },
  { type: 'contractor', firstName: 'Lena', lastName: 'Novak', dob: '1990-01-15', company: 'Northgate HVAC' },
  { type: 'contractor', firstName: 'Carlos', lastName: 'Mendez', dob: '1982-11-29', company: 'Brightline Electrical' },
  { type: 'contractor', firstName: 'Owen', lastName: 'Price', dob: '1977-04-04', company: 'Cedar Elevator Co.' },
];

// People whose only visits are older than the default retention period of 365 days.
const PAST_PEOPLE = [
  { type: 'visitor', firstName: 'Walter', lastName: 'Finch', dob: '1949-02-11' },
  { type: 'visitor', firstName: 'Irene', lastName: 'Castillo', dob: '1970-07-07' },
];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function atLocal(base, daysAgo, hour, minute) {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function minutesBefore(base, minutes) {
  return new Date(base.getTime() - minutes * 60000);
}

// Returns plain descriptions; the service gives them ids, numbers and audit entries.
// Each visit names its person by index into `people`.
export function buildSampleData(now) {
  const random = mulberry32(20261012);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const people = [...RECENT_PEOPLE, ...PAST_PEOPLE].map((p) => ({ company: null, ...p }));
  const recentCount = RECENT_PEOPLE.length;
  const visits = [];

  // Three people in the building now.
  const present = [
    { person: 4, destination: 'Council Chambers', minutes: 75 },
    { person: 7, destination: 'Building Services', minutes: 190 },
    { person: 2, destination: 'Planning & Permits', minutes: 25 },
  ];
  for (const p of present) {
    visits.push({ person: p.person, destination: p.destination, signInAt: minutesBefore(now, p.minutes), signOutAt: null, screening: 'no match' });
  }

  // Three weeks of weekday traffic before today, at most one visit per person per day.
  const used = new Set();
  for (let daysAgo = 1; daysAgo <= 21; daysAgo += 1) {
    const day = atLocal(now, daysAgo, 12, 0);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const count = 1 + Math.floor(random() * 4);
    for (let i = 0; i < count; i += 1) {
      const person = Math.floor(random() * recentCount);
      if (used.has(`${person}:${daysAgo}`) || (person === 5 && daysAgo === 6)) continue;
      used.add(`${person}:${daysAgo}`);
      const signInAt = atLocal(now, daysAgo, 8 + Math.floor(random() * 8), Math.floor(random() * 60));
      const stay = 20 + Math.floor(random() * 200);
      const contractor = people[person].type === 'contractor';
      visits.push({
        person,
        destination: contractor ? pick(['Building Services', 'Building Services', 'Records Room', 'Council Chambers']) : pick(DESTINATIONS),
        signInAt,
        signOutAt: new Date(signInAt.getTime() + stay * 60000),
        screening: 'no match',
      });
    }
  }

  // One past sign-in held because screening was switched off, then admitted.
  const heldIn = atLocal(now, 6, 10, 15);
  visits.push({
    person: 5,
    destination: 'Main Office',
    signInAt: heldIn,
    signOutAt: new Date(heldIn.getTime() + 50 * 60000),
    screening: 'not run',
    decision: {
      decision: 'admit',
      reason: 'Watchlist screening was off while the list was rebuilt. Visitor is expected by Main Office and showed ID.',
      cause: 'an Administrator had switched watchlist screening off in Settings',
    },
  });

  // Visits older than the 365-day retention period.
  const old = [
    { person: recentCount, daysAgo: 420, destination: 'Records Room' },
    { person: recentCount + 1, daysAgo: 401, destination: 'Finance, 2nd Floor' },
    { person: recentCount + 1, daysAgo: 395, destination: 'Main Office' },
    { person: 3, daysAgo: 390, destination: 'Planning & Permits' },
  ];
  for (const o of old) {
    const signInAt = atLocal(now, o.daysAgo, 9 + Math.floor(random() * 6), Math.floor(random() * 60));
    visits.push({ person: o.person, destination: o.destination, signInAt, signOutAt: new Date(signInAt.getTime() + 45 * 60000), screening: 'no match' });
  }

  visits.sort((a, b) => a.signInAt - b.signInAt);
  return { destinations: DESTINATIONS, watchlist: WATCHLIST, people, visits };
}

// Suggestions shown on the Sign In page while the example records are in use.
export const SAMPLE_TRIES = [
  { label: 'A returning visitor', detail: 'Find "Lopez" and sign Ana Lopez in without typing her details.' },
  { label: 'A watchlist match', detail: 'Manual Entry: Marcus Reed, born 22 July 1985. The sign-in is held.' },
  { label: 'A possible match', detail: 'Manual Entry: Marcus Reed with any other date of birth.' },
  { label: 'A contractor', detail: 'Choose Contractor and find "Okafor", "Novak" or "Price".' },
];
