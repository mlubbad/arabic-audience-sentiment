/**
 * What the morning summary says, kept apart from the card so it is tested
 * without rendering: the latest snapshot (`admin_daily_digest()`) read
 * against the one before it.
 *
 * Without an earlier snapshot (the first morning after the deploy) there is
 * nothing to compare: the card lists what fails now and says the comparison
 * starts with the next snapshot.
 */
import type { AdminDailyDigest } from "@sentiment/contracts";

type Snapshot = NonNullable<AdminDailyDigest["latest"]>;
type Failing = Snapshot["body"]["failing"][number];
type Mover = Snapshot["body"]["movers"][number];

export type DigestView = {
  day: string;
  recordedAt: string;
  /** False on the first snapshot: the lists and deltas below are then the
   *  current state, not a change. */
  compared: boolean;
  failing: Failing[];
  newlyFailing: Failing[];
  recovered: Failing[];
  /** Comments collected and analysed since the earlier snapshot; null
   *  without one. A total that fell (a channel removed) reads as 0. */
  collected: number | null;
  analysed: number | null;
  stale: number;
  failedRuns: number;
  imported: number;
  movers: Mover[];
};

export const failingName = (f: Failing | Mover) =>
  f.title ?? f.handle ?? f.channel_id;

export function digestView(d: AdminDailyDigest): DigestView | null {
  if (!d.latest) return null;
  const now = d.latest.body;
  const before = d.previous?.body ?? null;
  const ids = (list: Failing[]) => new Set(list.map((f) => f.channel_id));
  const was = before ? ids(before.failing) : null;
  const is = ids(now.failing);
  return {
    day: d.latest.day,
    recordedAt: d.latest.recorded_at,
    compared: before !== null,
    failing: now.failing,
    newlyFailing: was ? now.failing.filter((f) => !was.has(f.channel_id)) : [],
    recovered: before
      ? before.failing.filter((f) => !is.has(f.channel_id))
      : [],
    collected: before ? Math.max(0, now.comments - before.comments) : null,
    analysed: before ? Math.max(0, now.analysed - before.analysed) : null,
    stale: now.states.stale,
    failedRuns: now.failed_runs,
    imported: now.imported,
    movers: now.movers,
  };
}
