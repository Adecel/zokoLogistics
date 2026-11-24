const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// "+01:00" -> 60
export function offsetMinutes(offset: string) {
  const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

// Today's date in the company's time zone, as a local-midnight Date
export function businessToday(utcOffset: string) {
  const shifted = new Date(Date.now() + offsetMinutes(utcOffset) * 60_000);
  return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

// Days from today+min to today+max (inclusive), in the company's time zone
export function bookableDays(utcOffset: string, minDays: number, maxDays: number) {
  const today = businessToday(utcOffset);
  return Array.from({ length: Math.max(0, maxDays - minDays + 1) }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + minDays + i);
    return d;
  });
}

// { start: "06:00", end: "20:00", step_minutes: 30 } -> ["06:00", "06:30", ... "20:00"]
export function timeSlots(hours: { start: string; end: string; step_minutes: number }) {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const step = Math.max(5, hours.step_minutes || 30);
  const slots: string[] = [];
  for (let m = toMin(hours.start); m <= toMin(hours.end); m += step) {
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return slots;
}

// ("2026-11-29", "08:30", "+01:00") -> "2026-11-29T08:30:00+01:00"
export function toTimestamp(isoDate: string, time: string, utcOffset: string) {
  return `${isoDate}T${time}:00${utcOffset}`;
}

export function dayName(d: Date) {
  return DAYS[d.getDay()];
}

export function monthName(d: Date) {
  return MONTHS[d.getMonth()];
}

// "Sam. 29 nov."
export function formatShortDate(d: Date) {
  return `${dayName(d)}. ${d.getDate()} ${monthName(d)}`;
}

// Date -> "2026-11-29" (local date, used in URLs)
export function toISODate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-11-29" -> Date (local midnight), or null if invalid
export function fromISODate(s: string | undefined) {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ISO timestamp -> "Sam. 29 nov. à 08:00" in the company's time zone
export function formatBusinessDateTime(iso: string, utcOffset: string) {
  const d = new Date(new Date(iso).getTime() + offsetMinutes(utcOffset) * 60_000);
  const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${formatShortDate(local)} à ${time}`;
}
