import type { Minutes, WorldCalendar } from './types';

export const DEFAULT_CALENDAR: WorldCalendar = { kind: 'gregorian', start: '2026-01-01T08:00', yearLabel: '', startYear: 1, daysPerYear: 365, monthNames: [], hoursPerDay: 24 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

function startMs(start: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(start.trim());
  if (!m) return Date.UTC(2026, 0, 1, 8, 0);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 8), Number(m[5] ?? 0));
}

/** "Tue 14 Oct 2026, 08:20" or "Year 312 AF, Thaw 4, 08:20" or "Day 34, 08:20". */
export function formatTime(cal: WorldCalendar | undefined, at: Minutes): string {
  const c = cal ?? DEFAULT_CALENDAR;
  if (c.kind === 'gregorian') {
    const d = new Date(startMs(c.start) + Math.round(at) * 60000);
    return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  const hpd = Math.max(1, c.hoursPerDay || 24);
  const dayMin = hpd * 60;
  const total = Math.max(0, Math.round(at));
  const dayIndex = Math.floor(total / dayMin);
  const mins = total - dayIndex * dayMin;
  const clock = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  const dpy = Math.max(1, c.daysPerYear || 0);
  if (!c.daysPerYear) return `Day ${dayIndex + 1}, ${clock}`;
  const year = c.startYear + Math.floor(dayIndex / dpy);
  const dayOfYear = dayIndex % dpy;
  const months = c.monthNames.filter((x) => x.trim());
  const label = c.yearLabel.trim() ? ` ${c.yearLabel.trim()}` : '';
  if (months.length) {
    const per = Math.ceil(dpy / months.length);
    const mi = Math.min(months.length - 1, Math.floor(dayOfYear / per));
    return `Year ${year}${label}, ${months[mi]} ${dayOfYear - mi * per + 1}, ${clock}`;
  }
  return `Year ${year}${label}, day ${dayOfYear + 1}, ${clock}`;
}

/** Short form for chips: "14 Oct, 08:20" / "Day 34, 08:20". */
export function formatShort(cal: WorldCalendar | undefined, at: Minutes): string {
  const full = formatTime(cal, at);
  if ((cal ?? DEFAULT_CALENDAR).kind === 'gregorian') return full.replace(/^\w{3} (\d+ \w{3}) \d{4}/, '$1');
  return full.replace(/^Year \d+[^,]*, /, '');
}

/** The hour of the day on a 24-hour scale (a 30-hour world day is squeezed to fit), for schedules and crowds. */
export function hourOfDay(cal: WorldCalendar | undefined, at: Minutes): number {
  const c = cal ?? DEFAULT_CALENDAR;
  const hpd = c.kind === 'gregorian' ? 24 : Math.max(1, c.hoursPerDay || 24);
  const offset = c.kind === 'gregorian' ? Math.floor(startMs(c.start) / 60000) : 0;
  const m = (((Math.round(at) + offset) % (hpd * 60)) + hpd * 60) % (hpd * 60);
  return (m / 60) * (24 / hpd);
}

/** Which day it is, counting from the calendar's start: for daily restocks, rent and income. */
export function dayIndex(cal: WorldCalendar | undefined, at: Minutes): number {
  const c = cal ?? DEFAULT_CALENDAR;
  const hpd = c.kind === 'gregorian' ? 24 : Math.max(1, c.hoursPerDay || 24);
  const offset = c.kind === 'gregorian' ? Math.floor(startMs(c.start) / 60000) : 0;
  return Math.floor((Math.round(at) + offset) / (hpd * 60));
}

export function timeOfDay(cal: WorldCalendar | undefined, at: Minutes): string {
  const h = hourOfDay(cal, at);
  if (h < 5) return 'deep night';
  if (h < 7) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/** "45 min", "3 h 10 min", "2 days 4 h". */
export function formatDuration(minutes: Minutes): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const r = m % 60;
  if (d) return `${d} day${d > 1 ? 's' : ''}${h ? ` ${h} h` : ''}`;
  return `${h} h${r ? ` ${r} min` : ''}`;
}

const UNITS: [RegExp, number][] = [
  [/^(?:s|sec|secs|second|seconds)$/, 1 / 60],
  [/^(?:m|min|mins|minute|minutes)$/, 1],
  [/^(?:h|hr|hrs|hour|hours)$/, 60],
  [/^(?:d|day|days)$/, 1440],
  [/^(?:w|wk|week|weeks)$/, 10080],
  [/^(?:month|months)$/, 43200],
  [/^(?:y|yr|year|years)$/, 525600],
];
const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, thirty: 30, half: 0.5, few: 3, several: 4, couple: 2 };

/** Minutes from what a model writes: 25, "25", "20 minutes", "an hour and a half", "2 days". Unknown → 0. */
export function parseDuration(v: unknown): Minutes {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  if (typeof v !== 'string') return 0;
  const s = v.toLowerCase().replace(/-/g, ' ').trim();
  if (!s) return 0;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Math.round(Number(s));
  const words = s.split(/[^a-z0-9.]+/).filter(Boolean);
  let total = 0;
  let lastUnit = 0;
  for (let i = 0; i < words.length; i++) {
    const unit = UNITS.find(([u]) => u.test(words[i]!));
    if (!unit) continue;
    // The quantity is the nearest number word before the unit, skipping "of", "a", "an".
    let qty: number | undefined;
    for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
      const w = words[k]!;
      if (w === 'of') continue;
      const n = /^\d+(?:\.\d+)?$/.test(w) ? Number(w) : WORDS[w];
      if (n != null) { qty = n; if (w !== 'a' && w !== 'an') break; }
      else break;
    }
    total += (qty ?? 1) * unit[1];
    lastUnit = unit[1];
  }
  if (/and a half/.test(s) && lastUnit) total += lastUnit / 2;
  if (!total && /\b(moment|instant)\b/.test(s)) total = 1;
  return Math.round(total);
}

export interface TimeParts {
  /** gregorian: 'YYYY-MM-DD'. */
  date: string;
  /** custom: day number from 1. */
  day: number;
  hour: number;
  minute: number;
}

/** Split an in-world time into the fields a person edits. */
export function toParts(cal: WorldCalendar | undefined, at: Minutes): TimeParts {
  const c = cal ?? DEFAULT_CALENDAR;
  if (c.kind === 'gregorian') {
    const d = new Date(startMs(c.start) + Math.round(at) * 60000);
    return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, day: 1, hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }
  const dayMin = Math.max(1, c.hoursPerDay || 24) * 60;
  const total = Math.max(0, Math.round(at));
  const day = Math.floor(total / dayMin);
  const rest = total - day * dayMin;
  return { date: '', day: day + 1, hour: Math.floor(rest / 60), minute: rest % 60 };
}

/** Back from edited fields to minutes; never before minute 0. */
export function fromParts(cal: WorldCalendar | undefined, p: Partial<TimeParts>): Minutes {
  const c = cal ?? DEFAULT_CALENDAR;
  const hm = Math.max(0, (p.hour ?? 0)) * 60 + Math.max(0, p.minute ?? 0);
  if (c.kind === 'gregorian') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((p.date ?? '').trim());
    if (!m) return Math.max(0, hm);
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0) + hm * 60000;
    return Math.max(0, Math.round((ms - startMs(c.start)) / 60000));
  }
  const dayMin = Math.max(1, c.hoursPerDay || 24) * 60;
  return Math.max(0, (Math.max(1, Math.round(p.day ?? 1)) - 1) * dayMin + hm);
}
