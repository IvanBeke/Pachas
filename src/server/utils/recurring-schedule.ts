import type { Recurrence } from "./recurring-input";

/** Upper bound on occurrences created per template per run (catch-up cap). */
const MAX_OCCURRENCES_PER_RUN = 400;

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The `n`th occurrence (0-based) of a schedule starting on `start`. Monthly
 * and yearly schedules keep the start day and clamp to the month's end, so a
 * schedule starting on the 31st falls on Feb 28/29, then Mar 31 again.
 */
export function occurrenceDate(
  start: string,
  recurrence: Recurrence,
  n: number,
): string {
  const s = parseDate(start);
  if (recurrence === "week") {
    return formatDate(new Date(s.getTime() + n * 7 * 86_400_000));
  }
  const months = recurrence === "month" ? n : n * 12;
  const total = s.getUTCMonth() + months;
  const year = s.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(s.getUTCDate(), daysInMonth(year, month));
  return formatDate(new Date(Date.UTC(year, month, day)));
}

/**
 * Occurrence dates that are due: after `after` (exclusive, or from the start
 * when null), on or before `today`, and within the optional end date.
 */
export function dueOccurrences(
  template: {
    startDate: string;
    endDate: string | null;
    recurrence: Recurrence;
    generatedThrough: string | null;
  },
  today: string,
  limit = MAX_OCCURRENCES_PER_RUN,
): string[] {
  const last = template.endDate && template.endDate < today ? template.endDate : today;
  const out: string[] = [];
  for (let n = 0; out.length < limit; n++) {
    const date = occurrenceDate(template.startDate, template.recurrence, n);
    if (date > last) break;
    if (template.generatedThrough && date <= template.generatedThrough) continue;
    out.push(date);
  }
  return out;
}

export function todayUtc(now = new Date()): string {
  return formatDate(now);
}
