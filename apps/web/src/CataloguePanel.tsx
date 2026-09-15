/**
 * The catalogue: what the channel has, what it costs, what is chosen.
 *
 * Sits first on the operations page because it is the action; the health and
 * plan panels below it are the diagnosis. The estimate is `selectionEstimate`
 * from the contract — the same arithmetic `select_videos` refuses on — shown
 * against the plan's remaining analysis units, which this page already reads.
 * There is no second meter here: `remaining` is the figure the plan panel
 * prints, handed in, so the two cannot disagree about how much is left.
 *
 * In fixture mode there is no client, so saving and refreshing are no-ops and
 * the save button's enablement is still what the reader would see live —
 * which is what the browser suite asserts on.
 *
 * Named `CataloguePanel.tsx`, not `Catalogue.tsx`: the loader beside it is
 * `catalogue.ts`, and on a case-insensitive filesystem `./Catalogue` resolves
 * to the `.ts` file first — tsc refuses the pair and Vite would import the
 * loader where the component was meant. The export is still `Catalogue`.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  filterCatalogue,
  fitNewest,
  selectionEstimate,
  type CatalogueKind,
  type CatalogueSort,
  type CatalogueVideo,
  type UsageSummary,
} from "@sentiment/contracts";
import { loadCatalogue, mergeCatalogue, type StoredCount } from "./catalogue";
import { supabase } from "./supabase";
import { displayDate } from "./i18n";
import { useLocale } from "./locale";
import { useStrings, type Strings } from "./strings";
import { describeJob, explainCode, type JobRow } from "./jobFeed";

const KINDS = ["all", "video", "short", "stream"] as const;

/** What select_videos says about the collection, as the reader is told it.
 *  A run already under way took its due list when it was claimed, so the new
 *  video waits for the next cycle and the sentence says so; a removal alone
 *  asks for no collection and the sentence says nothing about one. */
export function savedFeedback(
  r: { queued: boolean; deferred: boolean; already_running: boolean },
  S: Strings,
) {
  if (r.already_running) return S.catSavedRunning;
  if (r.queued) return S.catSaved;
  if (r.deferred) return S.catSavedDeferred;
  return S.catSavedRemoved;
}

export function Catalogue({
  mode,
  workspaceId,
  plan,
  stored,
  jobs,
  workerConnected,
  onChanged,
}: {
  mode: "live" | "sanitized_fixture";
  workspaceId: string;
  plan: UsageSummary | null;
  /** Rows stored per video — `storedPerVideo` of the page's source, the
   *  server's definition of "collected", not the dashboard's aggregate. */
  stored: StoredCount[];
  jobs: JobRow[] | null;
  /** For the discover job's sentence: queued reads differently with no worker. */
  workerConnected: boolean;
  onChanged: () => void;
}) {
  const S = useStrings();
  const lang = useLocale();
  const read = useQuery({
    queryKey: ["catalogue", mode, workspaceId],
    queryFn: ({ signal }) => loadCatalogue(mode, workspaceId, signal),
  });
  const rows = useMemo(
    () => (read.data ? mergeCatalogue(read.data, stored) : []),
    [read.data, stored],
  );
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<CatalogueKind>("all");
  const [sort, setSort] = useState<CatalogueSort>("newest");
  // Ticked boxes: what the reader wants selected, before saving. Reset to
  // what is stored whenever the stored set arrives or changes.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    setTicked(new Set(rows.filter((r) => r.selected).map((r) => r.id)));
  }, [rows]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const remaining =
    plan?.budgets.find((b) => b.event_type === "comment_analysis")?.remaining ??
    null;
  const shown = filterCatalogue(rows, { search, kind, sort });
  const saved = new Map(rows.map((r) => [r.id, r.selected]));
  const adding = new Set([...ticked].filter((id) => !saved.get(id)));
  const removing = rows
    .filter((r) => r.selected && !ticked.has(r.id))
    .map((r) => r.id);
  const est = selectionEstimate(rows, adding, remaining, new Set(removing));
  // What the stored selections still owe, whatever is ticked: the budget the
  // fit button has to work inside.
  const owed = selectionEstimate(rows, new Set(), remaining).outstanding;
  const collecting = (jobs ?? []).some((j) => j.status === "running");
  // No catalogue yet, but a discover job on the way: say where that job is,
  // in the attempt log's own words, rather than "no videos" as if nothing
  // were happening. Live-only — the fixture has no job table.
  const discovering =
    (jobs ?? []).find(
      (j) =>
        j.type === "discover" &&
        (j.status === "queued" || j.status === "running"),
    ) ?? null;
  const dirty = adding.size > 0 || removing.length > 0;
  const kindWord = (k: CatalogueVideo["kind"]) =>
    k === "video"
      ? S.catKindVideo
      : k === "short"
        ? S.catKindShort
        : S.catKindStream;

  const toggle = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = () => {
    if (!supabase || !read.data?.channelId) return;
    setBusy(true);
    setFeedback(null);
    void supabase
      .rpc("select_videos", {
        w: workspaceId,
        c: read.data.channelId,
        add: [...adding],
        remove: removing,
      })
      .then(({ data, error }) => {
        setBusy(false);
        if (error) {
          setFeedback(
            /quota_exceeded/.test(error.message)
              ? S.catSaveQuota
              : S.catSaveFailed,
          );
          return;
        }
        setFeedback(
          savedFeedback(
            data as {
              queued: boolean;
              deferred: boolean;
              already_running: boolean;
            },
            S,
          ),
        );
        void read.refetch();
        onChanged();
      });
  };
  const refresh = () => {
    if (!supabase || !read.data?.channelId) return;
    setBusy(true);
    setFeedback(null);
    void supabase
      .rpc("request_discovery", { w: workspaceId, c: read.data.channelId })
      .then(({ error }) => {
        setBusy(false);
        setFeedback(error ? S.catRequestFailed : S.catRequested);
        onChanged();
      });
  };

  const state = (r: CatalogueVideo) => {
    if (r.comments_state === "disabled") return S.catStateDisabled;
    if (!r.selected) return S.catStateUnselected;
    if (r.last_outcome && r.last_outcome !== "exhausted")
      return `${S.catStatePartial} · ${explainCode(r.last_outcome, S) ?? r.last_outcome}`;
    if (r.last_collected_at)
      return S.catStateCollected(
        r.collected,
        displayDate(r.last_collected_at, lang),
      );
    return collecting ? S.catStateCollecting : S.catStateWaiting;
  };

  return (
    <section
      className="rp-section catalogue"
      aria-labelledby="cat-heading"
      data-testid="catalogue"
    >
      <header>
        <h2 id="cat-heading">{S.catTitle}</h2>
        <p className="rp-sub">{S.catLead}</p>
      </header>
      {read.isPending ? (
        <p role="status">{S.opsReading}</p>
      ) : read.isError ? (
        <div role="alert" className="notice">
          <p>{S.catReadFailed}</p>
          <button type="button" onClick={() => void read.refetch()}>
            {S.retry}
          </button>
        </div>
      ) : (
        <>
          <div className="cat-toolbar">
            <input
              type="search"
              aria-label={S.catSearch}
              placeholder={S.catSearch}
              data-testid="cat-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div
              className="cat-kinds"
              role="group"
              aria-label={S.videoKindLabel}
            >
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="rp-tab"
                  aria-pressed={kind === k}
                  data-testid={`cat-kind-${k}`}
                  onClick={() => setKind(k)}
                >
                  {k === "all" ? S.catKindAll : kindWord(k)} (
                  {k === "all"
                    ? rows.length
                    : rows.filter((r) => r.kind === k).length}
                  )
                </button>
              ))}
            </div>
            <select
              aria-label={S.catSortLabel}
              data-testid="cat-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as CatalogueSort)}
            >
              <option value="newest">{S.catSortNewest}</option>
              <option value="oldest">{S.catSortOldest}</option>
              <option value="most_commented">{S.catSortMost}</option>
            </select>
            <button
              type="button"
              className="rp-tab"
              data-testid="cat-select-view"
              onClick={() =>
                shown.forEach(
                  (r) => r.comments_state !== "disabled" && toggle(r.id, true),
                )
              }
            >
              {S.catSelectView}
            </button>
            <button
              type="button"
              className="rp-tab"
              data-testid="cat-clear"
              onClick={() => setTicked(new Set())}
            >
              {S.catClear}
            </button>
            <button
              type="button"
              className="rp-tab"
              data-testid="cat-fit"
              disabled={remaining === null}
              onClick={() =>
                setTicked(
                  new Set([
                    ...rows.filter((r) => r.selected).map((r) => r.id),
                    ...fitNewest(rows, Math.max(0, (remaining ?? 0) - owed)),
                  ]),
                )
              }
            >
              {S.catFit}
            </button>
            {/* The same guard as the save button: live with no connected
                channel would call the server to be refused, so the button
                says so by being off. Fixture mode has no server at all. */}
            <button
              type="button"
              className="rp-tab"
              data-testid="cat-refresh"
              disabled={busy || mode !== "live" || !read.data?.channelId}
              onClick={refresh}
            >
              {S.catRefresh}
            </button>
            <small>
              {read.data?.cataloguedAt
                ? S.catRefreshed(displayDate(read.data.cataloguedAt, lang))
                : S.catNeverRefreshed}
            </small>
          </div>

          {rows.length === 0 && discovering ? (
            (() => {
              const e = describeJob(discovering, { workerConnected }, S);
              return (
                <p
                  className="rp-missing"
                  data-testid="cat-discovering"
                  data-severity={e.severity}
                >
                  <strong>{e.headline}</strong>
                  {e.detail}
                </p>
              );
            })()
          ) : rows.length === 0 ? (
            <p className="rp-missing" data-testid="cat-empty">
              <strong>{S.catEmpty}</strong>
            </p>
          ) : shown.length === 0 ? (
            <p className="rp-missing">
              <strong>{S.catNoMatch}</strong>
            </p>
          ) : (
            <ul className="cat-list">
              {shown.map((r) => (
                <li
                  key={r.id}
                  data-testid={`cat-row-${r.id}`}
                  data-kind={r.kind}
                >
                  <input
                    type="checkbox"
                    aria-label={r.title}
                    data-testid={`cat-check-${r.id}`}
                    checked={ticked.has(r.id)}
                    disabled={r.comments_state === "disabled" || busy}
                    onChange={(e) => toggle(r.id, e.target.checked)}
                  />
                  {r.thumbnail_url ? (
                    <img src={r.thumbnail_url} alt="" loading="lazy" />
                  ) : (
                    <span className="cat-thumb" aria-hidden="true" />
                  )}
                  <span className="cat-title">{r.title}</span>
                  <span className="cat-kind">{kindWord(r.kind)}</span>
                  <span className="cat-date">
                    {r.published_at
                      ? displayDate(r.published_at, lang)
                      : S.catCountUnknown}
                  </span>
                  <span className="cat-count">
                    {r.reported_comment_count === null
                      ? S.catCountUnknown
                      : r.reported_comment_count}
                  </span>
                  <span
                    className="cat-state"
                    data-testid={`cat-state-${r.id}`}
                    data-state={
                      r.comments_state === "disabled"
                        ? "disabled"
                        : r.selected
                          ? "selected"
                          : "none"
                    }
                  >
                    {state(r)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div
            className="cat-bar"
            data-testid="cat-estimate"
            data-exceeds={est.exceeds}
          >
            <span>
              {/* Everything ticked that is not yet stored: this selection's
                  additions and what the stored selections still owe. */}
              {S.catSelected(ticked.size, est.estimate + est.outstanding)}
              {est.unknownCount > 0
                ? ` · ${S.catUnknownCount(est.unknownCount)}`
                : ""}
              {" · "}
              {remaining === null
                ? S.catNoPlan
                : est.exceeds
                  ? S.catExceeds
                  : S.catRemainingAfter(est.remainingAfter ?? 0)}
            </span>
            <small>{S.catLiveNote}</small>
            <button
              type="button"
              data-testid="cat-save"
              disabled={
                !dirty ||
                est.exceeds ||
                busy ||
                (mode === "live" && !read.data?.channelId)
              }
              onClick={save}
            >
              {busy ? S.catSaving : S.catSave}
            </button>
            {feedback && (
              <p role="status" data-testid="cat-feedback">
                {feedback}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
