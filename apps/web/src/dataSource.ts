/**
 * What this screen is showing, and where it came from.
 *
 * The dashboard used to state three things as fixed text: that the data is
 * synthetic, that no channel is connected, and that corrections are never sent
 * anywhere. All three are false in live mode, and the third is the dangerous
 * one — it would tell someone their correction stayed in the browser at the
 * moment it was written to the server.
 *
 * So none of it is written by hand any more. Every sentence is derived from the
 * same values that decide the behaviour, which is the only way the label and the
 * truth cannot drift apart.
 */
import type { SyncState } from "./syncHealth";
import { syncHealth } from "./syncHealth";
import type { Strings } from "./strings";
import type { DataMode } from "./data";

/**
 * Grouped digits, pinned to one locale on purpose.
 *
 * toLocaleString("ar") renders Arabic-Indic digits where full ICU data is
 * available and Latin where it is not, so the same build would show different
 * numerals on different machines. The rest of this interface uses Latin digits,
 * and one component quietly disagreeing is worse than either choice made
 * consistently.
 */
const count = (n: number) => n.toLocaleString("en-US");

export type SourceDescription = {
  mode: DataMode;
  /** Short badge: what kind of data this is. */
  badge: string;
  /** Whose data, in the user's terms. */
  scope: string;
  /** What was collected, never overstating completeness. */
  coverage: string;
  /** Whether a correction made here is saved anywhere. */
  persistence: string;
  /** How current the collection is. Null when the question does not apply. */
  freshness: string | null;
  /** Drives the visual treatment; not a severity judgement of the data itself. */
  tone: "neutral" | "warning";
};

function coverageSentence(sync: SyncState | null, S: Strings): string {
  const run = sync?.last_run;
  if (!run) return S.dsNoRun;
  const { comments_collected, videos_seen, complete } = run.coverage;
  const counted = S.dsCounted(count(comments_collected), count(videos_seen));
  // "Complete" means the source was read to its end, never that every comment
  // that exists was retrieved. Saying "all comments" would be a claim nobody
  // can support.
  return complete
    ? S.dsCoverageComplete(counted)
    : S.dsCoveragePartial(counted);
}

function freshnessSentence(
  sync: SyncState | null,
  now: Date,
  S: Strings,
): string {
  const health = syncHealth(sync, now);
  if (health.key === "no_data" || health.key === "never_run")
    return S.dsNoPreviousRun;
  if (health.staleHours === null) return S.dsHealthUnknown;
  const hours = Math.round(health.staleHours);
  if (hours < 1) return S.dsUpdatedUnderHour;
  return S.dsUpdatedHours(count(hours));
}

export function describeSource(input: {
  mode: DataMode;
  workspaceId: string;
  workspaceName?: string | null;
  persisted: boolean;
  sync: SyncState | null;
  /** Null while the snapshot has not been read. Not zero — see below. */
  total: number | null;
  now: Date;
  S: Strings;
}): SourceDescription {
  const { mode, workspaceId, workspaceName, persisted, sync, total, now, S } =
    input;
  // The strip is shown beside the title from the first paint, before any data
  // has arrived. "Not read yet" and "read, and empty" are different answers, and
  // rendering a zero here would give the second when the first is true.
  const unread = total === null;
  if (mode === "sanitized_fixture")
    return {
      mode,
      badge: S.dsFixtureBadge,
      scope: S.dsFixtureScope,
      coverage: unread ? S.dsFixtureReading : S.dsFixtureCoverage(count(total)),
      // Keyed on the same flag the write path uses, so it cannot say one thing
      // while the code does another.
      persistence: persisted ? S.dsReviewsPersist : S.dsReviewsSessionOnly,
      freshness: null,
      tone: "warning",
    };

  return {
    mode,
    badge: S.dsLiveBadge,
    scope: workspaceName?.trim() || S.dsWorkspaceById(workspaceId),
    coverage: unread ? S.dsReadingLive : coverageSentence(sync, S),
    persistence: persisted ? S.dsReviewsLogged : S.dsReviewsNotSaved,
    freshness: unread ? null : freshnessSentence(sync, now, S),
    tone: "neutral",
  };
}
