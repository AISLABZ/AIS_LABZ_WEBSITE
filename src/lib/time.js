const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `date` in an IANA time zone. */
export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: WEEKDAYS[p.weekday] };
}

/** ISO-8601 week key (e.g. "2026-W40") for the local date in a time zone. */
export function isoWeekKey(date, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Next occurrence (as a UTC Date) of weekday/hour in a time zone, searching hour by hour. */
export function nextScheduledRun(now, { timezone, publishDayIndex, publishHour }) {
  const start = new Date(Math.ceil(now.getTime() / 3600000) * 3600000);
  for (let i = 0; i < 24 * 8; i++) {
    const t = new Date(start.getTime() + i * 3600000);
    const p = zonedParts(t, timezone);
    if (p.weekday === publishDayIndex && p.hour === publishHour) return t;
  }
  return null;
}

export function today(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function formatDisplayDate(iso, locale = 'en-GB') {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
}
