import type { VesselFix } from "@/lib/data/types";

export function departureLateMinutes(fix: VesselFix): number | null {
  if (!fix.left || !fix.sched) return null;
  const lateMs = Date.parse(fix.left) - Date.parse(fix.sched);
  // Card clocks omit seconds. Count only completed minutes so matching
  // displayed times never claim a one-minute delay.
  if (lateMs < 60_000 || lateMs > 120 * 60_000) return null;
  return Math.floor(lateMs / 60_000);
}
