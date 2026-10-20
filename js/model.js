// Pure plant-care logic (no browser APIs), so it can be tested on its own.
// Dates are stored as local calendar days, "YYYY-MM-DD", which avoids
// time-zone surprises when you water at night or travel.

export const CARE_TYPES = {
  water: { action: 'Water', past: 'Watered', icon: 'drop' },
  feed: { action: 'Feed', past: 'Fed', icon: 'leaf' },
  repot: { action: 'Repot', past: 'Repotted', icon: 'repot' },
};

const pad = (n) => String(n).padStart(2, '0');

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(fromStr, toStr) {
  return dayNumber(toStr) - dayNumber(fromStr);
}

export function isValidDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayNumber(s));
}

/** Newest first: by day, then by exact time when two logs share a day. */
export function sortEventsNewestFirst(events) {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.at || '').localeCompare(a.at || '');
  });
}

export function lastEvent(events, type) {
  let best = null;
  for (const e of events) {
    if (e.type !== type) continue;
    if (!best || e.date > best.date || (e.date === best.date && (e.at || '') > (best.at || ''))) best = e;
  }
  return best;
}

export function intervalOf(plant) {
  const n = Math.round(Number(plant.intervalDays));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : 7;
}

export function nextWateringDay(plant, events) {
  const last = lastEvent(events, 'water');
  const base = last ? last.date : (plant.addedOn || todayStr());
  return addDays(base, intervalOf(plant));
}

/** Negative = overdue, 0 = today. */
export function daysUntilWatering(plant, events, today = todayStr()) {
  return daysBetween(today, nextWateringDay(plant, events));
}

export function wateringStatus(days) {
  if (days < -1) return { text: `Overdue by ${-days} days`, tone: 'overdue' };
  if (days === -1) return { text: 'Overdue by 1 day', tone: 'overdue' };
  if (days === 0) return { text: 'Water today', tone: 'today' };
  if (days === 1) return { text: 'Water tomorrow', tone: 'soon' };
  return { text: `Water in ${days} days`, tone: 'later' };
}

export function formatDay(dateStr, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!isValidDay(dateStr)) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export function relativeDay(dateStr, today = todayStr()) {
  const diff = daysBetween(dateStr, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  return formatDay(dateStr);
}
