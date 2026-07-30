// Groups /data/adjustments.json into month grids for the service calendar.
// Pure date-string math (UTC-noon anchors) - no timezone drift, fully
// unit-testable.

import type { AdjustmentEntry, AdjustmentsDoc } from "./types";

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  dayNum: number;
  entries: AdjustmentEntry[];
}

export interface CalendarMonth {
  key: string; // YYYY-MM
  label: string; // "August 2026"
  /** Sunday-first weeks; null = leading/trailing pad cell. */
  weeks: (CalendarDay | null)[][];
  cancels: number;
  adds: number;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

function anchor(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

/** Months (only those containing entries), each as a padded Sunday-first grid. */
export function buildCalendar(doc: AdjustmentsDoc): CalendarMonth[] {
  const byDate = new Map<string, AdjustmentEntry[]>();
  for (const entry of doc.adjustments) {
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }

  const monthKeys = [...new Set([...byDate.keys()].map((d) => d.slice(0, 7)))].sort();
  return monthKeys.map((key) => {
    const first = anchor(`${key}-01`);
    const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const days: CalendarDay[] = Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${key}-${String(i + 1).padStart(2, "0")}`;
      return { date, dayNum: i + 1, entries: byDate.get(date) ?? [] };
    });

    const cells: (CalendarDay | null)[] = [
      ...Array.from({ length: first.getUTCDay() }, () => null),
      ...days,
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

    const flat = days.flatMap((d) => d.entries);
    return {
      key,
      label: MONTH_LABEL.format(first),
      weeks,
      cancels: flat.filter((e) => e.type === "cancel").length,
      adds: flat.filter((e) => e.type === "add").length,
    };
  });
}
