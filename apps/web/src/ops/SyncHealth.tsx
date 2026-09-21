/**
 * Sync health: is collection running, and since when.
 *
 * Split out of `OperationsPanels.tsx`, unchanged in behaviour — the same
 * `health`/`run`/`mode`/`channelId` read that used to sit in the health
 * half of `sync-grid` now has its own file. The severity badge is new: the
 * old markup put the state only in `data-severity` for the e2e suite and a
 * bold line of text; `Badge` gives a sighted reader the same colour the
 * attribute already gave a test.
 */
import { Card } from "../ui/Card";
import { Badge, type BadgeProps } from "../ui/Badge";
import type { Health } from "../syncHealth";
import type { SyncState } from "@sentiment/contracts";
import { displayDate, formatDuration, formatElapsed } from "../i18n";
import type { Locale } from "../locale";
import type { Strings } from "../strings";
import { explainCode } from "../jobFeed";

const SEVERITY_TONE: Record<Health["severity"], BadgeProps["tone"]> = {
  ok: "success",
  warning: "warning",
  critical: "danger",
  unknown: "neutral",
};

export function SyncHealth({
  s,
  sync,
  health,
  run,
  mode,
  channelId,
  lang,
  S,
}: {
  s?: { sync: SyncState | null } | undefined;
  sync?: SyncState | null;
  health: Health;
  run: SyncState["last_run"] | null;
  mode: "live" | "sanitized_fixture";
  /** The connected channel, or null: the health card says where to connect
   *  one. */
  channelId: string | null;
  lang: Locale;
  S: Strings;
}) {
  const currentSync = sync ?? s?.sync;
  const busy = currentSync?.worker?.busy ?? false;

  return (
    <section
      className="db-section"
      aria-labelledby="sync-heading"
      data-testid="sync-panel"
    >
      <header>
        <h2 id="sync-heading">{S.opsHealthTitle}</h2>
      </header>
      <Card>
        <p data-testid="sync-state" data-severity={health.severity}>
          <Badge tone={SEVERITY_TONE[health.severity]}>
            {S.syncMessages[health.key]}
          </Badge>
        </p>
        {health.errorCode && (
          <p data-testid="sync-error">
            {explainCode(health.errorCode, S) ?? S.opsUnclassifiedFailure} (
            <code>{health.errorCode}</code>)
          </p>
        )}
        {health.queued > 0 && (
          <p data-testid="sync-queued">
            {S.opsQueuedWithEta(
              health.queued,
              health.queued === 1
                ? lang === "ar"
                  ? "خلال 30–60 ثانية تقريباً"
                  : "~30–60s"
                : lang === "ar"
                  ? `خلال ~${Math.ceil((health.queued * 30) / 60)}–${Math.ceil((health.queued * 60) / 60)} دقيقة`
                  : `~${Math.ceil((health.queued * 30) / 60)}–${Math.ceil((health.queued * 60) / 60)} mins`,
            )}
          </p>
        )}
        <p data-testid="sync-worker">
          {S.opsWorkerLabel}{" "}
          {currentSync?.worker.connected
            ? `${S.opsWorkerConnected(
                displayDate(currentSync.worker.last_heartbeat_at, lang),
              )}${busy ? ` · ${S.opsWorkerBusyEta(lang === "ar" ? "خلال دقيقة تقريباً" : "within ~1 min")}` : ""}`
            : S.opsWorkerDisconnected}
        </p>
        {/* The remedy used to be a "request sync" button here. It is the
            catalogue now, at the top of the page: choosing a video is what
            starts a collection. What remains is the case where no remedy can
            work — no connected channel — which says where to go instead of
            offering a button that would always fail. */}
        {mode === "live" && !channelId && (
          <p className="db-muted" data-testid="sync-no-channel">
            {S.opsNoChannelBefore} <a href="/account">{S.opsNoChannelLink}</a>{" "}
            {S.opsNoChannelAfter}
          </p>
        )}
        {run ? (
          <p data-testid="sync-last-run">
            {S.opsLastRun(
              displayDate(run.started_at, lang),
              run.source,
              run.coverage.videos_seen,
              run.coverage.comments_collected,
            )}{" "}
            {run.coverage.complete
              ? S.opsTraversalComplete
              : S.opsTraversalUnproven}
            {run.ended_at && run.started_at ? (
              <>
                {" "}
                ·{" "}
                {S.opsDurationTaken(
                  formatDuration(
                    Math.max(
                      1,
                      Math.round(
                        (new Date(run.ended_at).getTime() -
                          new Date(run.started_at).getTime()) /
                          1000,
                      ),
                    ),
                    lang,
                  ),
                )}
              </>
            ) : !run.ended_at ? (
              <>
                {S.opsRunningDuration(formatElapsed(run.started_at, lang))}
                {S.opsEstimatedCompletion(
                  lang === "ar" ? "خلال دقيقة تقريباً" : "within ~1 min",
                )}
              </>
            ) : null}
          </p>
        ) : (
          <p data-testid="sync-last-run">{S.opsNoPreviousRun}</p>
        )}
      </Card>
    </section>
  );
}
