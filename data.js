/* ============================================================
   data.js — everything you might want to edit lives here.
   ============================================================ */

/* Passphrase gate.
   Default passphrase: sixburgh
   To change it, get the SHA-256 of your new passphrase and paste it below.
   Easiest way: open this page, press F12, and run in the console:
     crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourpass'))
       .then(b => console.log([...new Uint8Array(b)]
         .map(x => x.toString(16).padStart(2,'0')).join('')))
*/
const PASS_HASH = '2bbd9051fed0c407c7ae1c595a8a3395d1f8291980c19f1477d225280ed77e6d';

/* Season being tracked. */
const SEASON = 2026;

/* Picks. Keys are week numbers. Week 9 is the bye, so it is not listed.
   'W' = Steelers win, 'L' = Steelers loss. */
const PREDICTIONS = {
  Matt: {
    1: 'W', 2: 'L', 3: 'W', 4: 'W', 5: 'W', 6: 'W', 7: 'L', 8: 'W',
    10: 'L', 11: 'L', 12: 'W', 13: 'W', 14: 'L', 15: 'W', 16: 'W', 17: 'W', 18: 'L'
  },
  Manny: {
    1: 'W', 2: 'W', 3: 'W', 4: 'W', 5: 'L', 6: 'W', 7: 'W', 8: 'W',
    10: 'L', 11: 'L', 12: 'W', 13: 'W', 14: 'L', 15: 'W', 16: 'W', 17: 'W', 18: 'L'
  },
  Lauren: {
    1: 'W', 2: 'W', 3: 'W', 4: 'W', 5: 'L', 6: 'W', 7: 'W', 8: 'W',
    10: 'W', 11: 'L', 12: 'W', 13: 'L', 14: 'L', 15: 'W', 16: 'W', 17: 'L', 18: 'W'
  },
  Ethan: {
    1: 'W', 2: 'L', 3: 'W', 4: 'W', 5: 'W', 6: 'L', 7: 'L', 8: 'W',
    10: 'L', 11: 'L', 12: 'W', 13: 'L', 14: 'L', 15: 'W', 16: 'W', 17: 'W', 18: 'L'
  }
};

/* Schedule fallback. Used to draw the board before kickoff and if the
   live feed is ever unreachable. Results come from the live feed. */
const SCHEDULE = [
  { week: 1,  date: '2026-09-13', opp: 'ATL', oppName: 'Falcons',  site: 'home' },
  { week: 2,  date: '2026-09-20', opp: 'NE',  oppName: 'Patriots', site: 'away' },
  { week: 3,  date: '2026-09-27', opp: 'CIN', oppName: 'Bengals',  site: 'home' },
  { week: 4,  date: '2026-10-02', opp: 'CLE', oppName: 'Browns',   site: 'away' },
  { week: 5,  date: '2026-10-11', opp: 'IND', oppName: 'Colts',    site: 'home' },
  { week: 6,  date: '2026-10-18', opp: 'TB',  oppName: 'Buccaneers', site: 'away' },
  { week: 7,  date: '2026-10-25', opp: 'NO',  oppName: 'Saints',   site: 'neutral' },
  { week: 8,  date: '2026-11-01', opp: 'CLE', oppName: 'Browns',   site: 'home' },
  { week: 10, date: '2026-11-16', opp: 'CIN', oppName: 'Bengals',  site: 'away' },
  { week: 11, date: '2026-11-22', opp: 'PHI', oppName: 'Eagles',   site: 'away' },
  { week: 12, date: '2026-11-27', opp: 'DEN', oppName: 'Broncos',  site: 'home' },
  { week: 13, date: '2026-12-07', opp: 'HOU', oppName: 'Texans',   site: 'home' },
  { week: 14, date: '2026-12-15', opp: 'JAX', oppName: 'Jaguars',  site: 'away' },
  { week: 15, date: '2026-12-20', opp: 'BAL', oppName: 'Ravens',   site: 'home' },
  { week: 16, date: '2026-12-27', opp: 'CAR', oppName: 'Panthers', site: 'home' },
  { week: 17, date: '2027-01-03', opp: 'TEN', oppName: 'Titans',   site: 'away' },
  { week: 18, date: '2027-01-10', opp: 'BAL', oppName: 'Ravens',   site: 'away' }
];

/* Manual results, only used if the live feed cannot be reached.
   Format: { week: 'W' } or { week: 'L' } or { week: 'T' }
   Example: const MANUAL_RESULTS = { 1: 'W', 2: 'L' }; */
const MANUAL_RESULTS = { };
