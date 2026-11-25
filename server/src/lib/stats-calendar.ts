import type { DatabaseSync } from 'node:sqlite';

export function registerStatsCalendar(db: DatabaseSync): void {
  let zone: string | undefined;
  let formatter: Intl.DateTimeFormat | undefined;
  let lastSlot: number | undefined;
  let lastKey = '';
  db.function('reader_stats_date', { deterministic: true }, (slot, timeZone) => {
    const stamp = Number(slot);
    if (typeof timeZone !== 'string' || !Number.isFinite(stamp)) return null;
    if (!formatter || zone !== timeZone) {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        calendar: 'iso8601',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      zone = timeZone;
      lastSlot = undefined;
    }
    if (lastSlot !== stamp) {
      const parts = formatter.formatToParts(stamp);
      lastKey = ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
      lastSlot = stamp;
    }
    return lastKey;
  });
}
