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
 * This file owns every piece of state — the read, the filters, the ticks,
 * the page, the open video, the save — as `CataloguePanel.tsx` did before
 * the cut. `SelectionBar` and `CataloguePreview` are its presentational
 * children: they print what they are handed and call back. The loader
 * beside this folder is `../catalogue.ts`; `./Catalogue` resolves here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  loadCatalogue,
  mergeCatalogue,
  pageOf,
  videoLinks,
  type StoredCount,
} from "../catalogue";
import { supabase } from "../supabase";
import { displayDate, formatElapsed } from "../i18n";
import { useLocale } from "../locale";
import { useStrings, type Strings } from "../strings";
import { describeJob, explainCode, type JobRow } from "../jobFeed";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { Input } from "../ui/Input";
import { Labelled } from "../ui/Labelled";
import { SelectItem } from "../ui/Select";
import { Tabs, TabsList, TabsTrigger } from "../ui/Tabs";
import { CataloguePreview } from "./CataloguePreview";
import { HistoricalImportModal } from "./HistoricalImportModal";
import { SelectionBar } from "./SelectionBar";
import "./catalogue.css";

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
  channelId,
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
  channelId?: string | null;
  onChanged: () => void;
}) {
  const S = useStrings();
  const lang = useLocale();
  const read = useQuery({
    queryKey: ["catalogue", mode, workspaceId],
    queryFn: ({ signal }) => loadCatalogue(mode, workspaceId, signal),
  });
  const effectiveChannelId = channelId ?? read.data?.channelId ?? null;
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
  // The list is cut into pages of fifty: 4,456 rows on one page is a slow
  // paint on a phone and a scrollbar nobody can use. The selection is not
  // paged — ticks survive a page change and the bar counts all of them.
  const [page, setPage] = useState(1);
  // The video being watched, if any. The player's iframe exists only while
  // this is set, so a page of thumbnails costs no embeds. The button that
  // opened it is kept so focus can go back there on close.
  const [previewing, setPreviewing] = useState<CatalogueVideo | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const [historicalModalOpen, setHistoricalModalOpen] = useState(false);

  // The budget's own figure, -1 included: that is a plan with no ceiling,
  // and `selectionEstimate` reads it as such rather than as a count.
  const remaining =
    plan?.budgets.find((b) => b.event_type === "comment_analysis")?.remaining ??
    null;
  const shown = filterCatalogue(rows, { search, kind, sort });
  const paged = pageOf(shown, page);
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
  const [, setTimerTick] = useState(0);
  useEffect(() => {
    if (discovering?.status !== "running" && discovering?.status !== "queued")
      return;
    const interval = setInterval(() => setTimerTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [discovering?.status]);

  // When a discover job finishes, immediately refetch the catalogue so the newly
  // discovered videos appear on screen without requiring a manual page reload.
  const prevDiscoveringRef = useRef(discovering);
  useEffect(() => {
    if (prevDiscoveringRef.current && !discovering) {
      hasCheckedSucceededDiscover.current = true;
      void read.refetch();
    }
    prevDiscoveringRef.current = discovering;
  }, [discovering, read]);

  // When active collection finishes, refetch so selections and comment counts update.
  const activeCollect = useMemo(
    () =>
      (jobs ?? []).find(
        (j) =>
          j.type === "collect" &&
          (j.status === "queued" || j.status === "running"),
      ) ?? null,
    [jobs],
  );
  const prevCollectRef = useRef(activeCollect);
  useEffect(() => {
    if (prevCollectRef.current && !activeCollect) {
      void read.refetch();
    }
    prevCollectRef.current = activeCollect;
  }, [activeCollect, read]);

  // If the catalogue read returned uncatalogued, but there is already a succeeded
  // discover job in the attempt log, refetch to recover from any race condition.
  const hasCheckedSucceededDiscover = useRef(false);
  const hasSucceededDiscover = (jobs ?? []).some(
    (j) => j.type === "discover" && j.status === "succeeded",
  );
  useEffect(() => {
    if (
      !hasCheckedSucceededDiscover.current &&
      !read.isPending &&
      read.data?.cataloguedAt === null &&
      hasSucceededDiscover
    ) {
      hasCheckedSucceededDiscover.current = true;
      void read.refetch();
    }
  }, [hasSucceededDiscover, read]);

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
    if (!supabase || !effectiveChannelId) return;
    setBusy(true);
    setFeedback(null);
    void supabase
      .rpc("select_videos", {
        w: workspaceId,
        c: effectiveChannelId,
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
    if (!supabase || !effectiveChannelId) return;
    setBusy(true);
    setFeedback(null);
    void supabase
      .rpc("request_discovery", { w: workspaceId, c: effectiveChannelId })
      .then(({ error }) => {
        setBusy(false);
        setFeedback(error ? S.catRequestFailed : S.catRequested);
        onChanged();
      });
  };

  const state = (r: CatalogueVideo) => {
    if (r.comments_state === "disabled") return S.catStateDisabled;
    if (!r.selected) {
      if (r.collected > 0) {
        if (r.analysed && r.analysed > 0) {
          return `${S.catStateUnselected} · ${S.catStateCollectedAnalysed(r.collected, r.analysed)}`;
        }
        return `${S.catStateUnselected} · ${S.catStateCollectedOnly(r.collected)}`;
      }
      return S.catStateUnselected;
    }
    // The live check compared the source's comment count with the one the
    // last read ended at and found it the same: the read is up to date. It
    // is a healthy state, and filing it under "partial" would make a video
    // nothing happened to look like one a read failed on.
    if (r.last_outcome === "unchanged") return S.catStateUnchanged;
    if (r.last_outcome === "telegram_discussion_requires_auth")
      return S.catStateTelegramAuthRequired;
    if (r.last_outcome && r.last_outcome !== "exhausted")
      return `${S.catStatePartial} · ${explainCode(r.last_outcome, S) ?? r.last_outcome}`;
    if (r.last_collected_at) {
      const base = S.catStateCollected(
        r.collected,
        displayDate(r.last_collected_at, lang),
      );
      if (r.analysed && r.analysed > 0) {
        return `${base} (${S.catStateAnalysedOnly(r.analysed)})`;
      }
      return base;
    }
    if (r.collected > 0) {
      if (r.analysed && r.analysed > 0) {
        return `${S.catStateCollectedOnly(r.collected)} (${S.catStateAnalysedOnly(r.analysed)})`;
      }
      return S.catStateCollectedOnly(r.collected);
    }
    return collecting ? S.catStateCollecting : S.catStateWaiting;
  };
  // The state badge's tone: a disabled video is a warning the reader can do
  // nothing about here; a stored one is the healthy case; the rest are plain.
  const stateOf = (r: CatalogueVideo) =>
    r.comments_state === "disabled"
      ? "disabled"
      : r.last_outcome === "telegram_discussion_requires_auth"
        ? "warning"
        : r.selected
          ? "selected"
          : r.collected > 0
            ? "unselected_stored"
            : "none";
  const toneOf = (s: ReturnType<typeof stateOf>) =>
    s === "disabled" || s === "warning"
      ? "warning"
      : s === "selected"
        ? "success"
        : s === "unselected_stored"
          ? "neutral"
          : "neutral";

  const totalCollectedAcrossRows = useMemo(
    () => rows.reduce((acc, r) => acc + r.collected, 0),
    [rows],
  );
  const totalAnalysedAcrossRows = useMemo(
    () => rows.reduce((acc, r) => acc + (r.analysed ?? 0), 0),
    [rows],
  );
  const videosWithStoredComments = useMemo(
    () => rows.filter((r) => r.collected > 0).length,
    [rows],
  );

  return (
    <section
      className="db-section db-catalogue"
      aria-labelledby="cat-heading"
      data-testid="catalogue"
      data-tour="catalogue"
    >
      <header>
        <h2 id="cat-heading">{S.catTitle}</h2>
        <p className="db-lead">{S.catLead}</p>
      </header>
      {!read.isPending && !read.isError && totalCollectedAcrossRows > 0 && (
        <aside
          className="db-cat-stats"
          data-testid="cat-stored-stats"
          aria-label={S.catSummaryTitle}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            padding: "0.75rem 1rem",
            background:
              "var(--color-surface-subtle, rgba(255, 255, 255, 0.03))",
            border: "1px solid var(--color-border, rgba(255, 255, 255, 0.08))",
            borderRadius: "8px",
            marginBottom: "1rem",
            fontSize: "0.875rem",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600 }}>📊 {S.catSummaryTitle}:</span>
          <Badge tone="success">
            {S.catTotalCollected(totalCollectedAcrossRows)}
          </Badge>
          {totalAnalysedAcrossRows > 0 && (
            <Badge tone="positive">
              {S.catTotalAnalysed(totalAnalysedAcrossRows)}
            </Badge>
          )}
          <Badge tone="neutral">
            {S.catVideosStored(videosWithStoredComments)}
          </Badge>
          <Badge tone={ticked.size > 0 ? "success" : "neutral"}>
            {S.catNextSyncSelected(ticked.size)}
          </Badge>
        </aside>
      )}
      {read.isPending ? (
        <p role="status" className="db-muted db-cat-reading">
          {S.opsReading}
        </p>
      ) : read.isError ? (
        <div role="alert" className="db-missing">
          <strong>{S.catReadFailed}</strong>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void read.refetch()}
          >
            {S.retry}
          </Button>
        </div>
      ) : (
        <>
          <div className="db-cat-toolbar">
            <div className="db-cat-toolbar-row db-cat-toolbar-filters">
              <Input
                type="search"
                className="db-cat-search"
                aria-label={S.catSearch}
                placeholder={S.catSearch}
                data-testid="cat-search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
              {/* Filters, not panels: the list below is the one view, so the
                  tabs carry no content of their own and point at none. */}
              <Tabs
                value={kind}
                onValueChange={(v) => {
                  setKind(v as CatalogueKind);
                  setPage(1);
                }}
              >
                <TabsList aria-label={S.videoKindLabel}>
                  {KINDS.map((k) => (
                    <TabsTrigger
                      key={k}
                      value={k}
                      data-testid={`cat-kind-${k}`}
                      aria-controls={undefined}
                    >
                      {k === "all" ? S.catKindAll : kindWord(k)} (
                      {k === "all"
                        ? rows.length
                        : rows.filter((r) => r.kind === k).length}
                      )
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Labelled
                id="cat-sort"
                label={S.catSortLabel}
                labelHidden
                testId="cat-sort"
                value={sort}
                onValueChange={(v) => {
                  setSort(v as CatalogueSort);
                  setPage(1);
                }}
              >
                <SelectItem value="newest">{S.catSortNewest}</SelectItem>
                <SelectItem value="oldest">{S.catSortOldest}</SelectItem>
                <SelectItem value="most_commented">{S.catSortMost}</SelectItem>
              </Labelled>
            </div>
            <div className="db-cat-toolbar-row db-cat-toolbar-actions">
              <div className="db-row-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="cat-select-page"
                  onClick={() =>
                    paged.rows.forEach(
                      (r) =>
                        r.comments_state !== "disabled" && toggle(r.id, true),
                    )
                  }
                >
                  {S.catSelectPage}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="cat-clear"
                  onClick={() => setTicked(new Set())}
                >
                  {S.catClear}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="cat-fit"
                  disabled={remaining === null}
                  onClick={() =>
                    setTicked(
                      new Set([
                        ...rows.filter((r) => r.selected).map((r) => r.id),
                        ...fitNewest(
                          rows,
                          est.unlimited
                            ? Infinity
                            : Math.max(0, (remaining ?? 0) - owed),
                        ),
                      ]),
                    )
                  }
                >
                  {S.catFit}
                </Button>
                {/* The same guard as the save button: live with no connected
                    channel would call the server to be refused, so the button
                    says so by being off. Fixture mode has no server at all. */}
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="cat-refresh"
                  disabled={busy || mode !== "live" || !effectiveChannelId}
                  onClick={refresh}
                >
                  {S.catRefresh}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="cat-historical-import"
                  disabled={busy || !effectiveChannelId}
                  onClick={() => setHistoricalModalOpen(true)}
                >
                  {S.historicalImportButton}
                </Button>
              </div>
              <p className="db-note db-cat-refreshed">
                {discovering?.status === "running" ? (
                  <span style={{ color: "var(--color-primary, #0284c7)" }}>
                    ⏱️{" "}
                    {S.catDiscoveringRunning(
                      formatElapsed(discovering.created_at, lang),
                      lang === "ar" ? "15–30 ثانية" : "15–30s",
                    )}
                  </span>
                ) : discovering?.status === "queued" ? (
                  <span style={{ color: "var(--color-warning, #d97706)" }}>
                    ⏱️{" "}
                    {S.catDiscoveringQueued(
                      formatElapsed(discovering.created_at, lang),
                      lang === "ar" ? "15–30 ثانية" : "15–30s",
                    )}
                  </span>
                ) : read.data?.cataloguedAt ? (
                  S.catRefreshed(displayDate(read.data.cataloguedAt, lang))
                ) : (
                  S.catNeverRefreshed
                )}
              </p>
            </div>
          </div>

          {rows.length === 0 && discovering ? (
            (() => {
              const e = describeJob(discovering, { workerConnected }, S);
              const curPlatform = read.data?.platform;
              const detail =
                e.detail === S.jobCatalogueRunningDetail
                  ? curPlatform === "telegram"
                    ? S.jobCatalogueRunningDetailTelegram
                    : curPlatform === "x"
                      ? S.jobCatalogueRunningDetailX
                      : curPlatform === "tiktok"
                        ? S.jobCatalogueRunningDetailTikTok
                        : e.detail
                  : e.detail;
              return (
                <div
                  className="db-missing"
                  data-testid="cat-discovering"
                  data-severity={e.severity}
                >
                  <p>
                    <strong>{e.headline}</strong>
                    {detail}
                  </p>
                  {discovering.status === "running" ? (
                    <p
                      style={{
                        marginTop: "0.5rem",
                        fontSize: "0.9em",
                        opacity: 0.9,
                      }}
                    >
                      ⏱️{" "}
                      {S.catDiscoveringRunning(
                        formatElapsed(discovering.created_at, lang),
                        lang === "ar" ? "15–30 ثانية" : "15–30s",
                      )}
                    </p>
                  ) : discovering.status === "queued" ? (
                    <p
                      style={{
                        marginTop: "0.5rem",
                        fontSize: "0.9em",
                        opacity: 0.9,
                      }}
                    >
                      ⏱️{" "}
                      {S.catDiscoveringQueued(
                        formatElapsed(discovering.created_at, lang),
                        lang === "ar" ? "15–30 ثانية" : "15–30s",
                      )}
                    </p>
                  ) : null}
                </div>
              );
            })()
          ) : rows.length === 0 ? (
            <p className="db-missing" data-testid="cat-empty">
              <strong>{S.catEmpty}</strong>
            </p>
          ) : shown.length === 0 ? (
            <p className="db-missing">
              <strong>{S.catNoMatch}</strong>
            </p>
          ) : (
            <ul className="db-cat-list" role="list">
              {paged.rows.map((r) => {
                const off = r.comments_state === "disabled";
                const s = stateOf(r);
                return (
                  <li key={r.id} data-testid={`cat-row-${r.id}`}>
                    <Card
                      className="db-cat-row"
                      data-kind={r.kind}
                      data-checked={ticked.has(r.id)}
                      data-disabled={off}
                    >
                      <Checkbox
                        label={r.title}
                        hideLabel
                        data-testid={`cat-check-${r.id}`}
                        checked={ticked.has(r.id)}
                        disabled={off || busy}
                        onCheckedChange={(on) => toggle(r.id, on === true)}
                      />
                      {/* The thumbnail and the title are one button: press
                          either to watch here. A button, not a link — nothing
                          navigates. */}
                      <button
                        type="button"
                        className="db-cat-open"
                        data-testid={`cat-open-${r.id}`}
                        aria-label={S.catPreview(r.title)}
                        onClick={(e) => {
                          previewTrigger.current = e.currentTarget;
                          setPreviewing(r);
                        }}
                      >
                        <span className="db-cat-thumb" aria-hidden="true">
                          {r.thumbnail_url ? (
                            <img
                              src={r.thumbnail_url}
                              alt=""
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <span className="db-cat-thumb-empty" />
                          )}
                          <span
                            className="db-cat-play"
                            data-testid={`cat-play-${r.id}`}
                          />
                        </span>
                        <span className="db-cat-title">{r.title}</span>
                      </button>
                      <a
                        className="db-cat-link"
                        data-testid={`cat-link-${r.id}`}
                        href={
                          videoLinks(
                            r.external_video_id,
                            r.kind,
                            r.platform ?? read.data?.platform,
                            read.data?.handle,
                          ).watch
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${
                          (r.platform ?? read.data?.platform) === "telegram"
                            ? S.catOpenTelegram
                            : (r.platform ?? read.data?.platform) === "x"
                              ? S.catOpenX
                              : (r.platform ?? read.data?.platform) === "tiktok"
                                ? S.catOpenTikTok
                                : S.catOpenYouTube
                        }: ${r.title}`}
                      >
                        ↗
                      </a>
                      <Badge className="db-cat-kind">{kindWord(r.kind)}</Badge>
                      <span className="db-cat-date">
                        {r.published_at
                          ? displayDate(r.published_at, lang)
                          : S.catCountUnknown}
                      </span>
                      <span
                        className="db-cat-count"
                        title={
                          r.reported_comment_count === null && r.collected === 0
                            ? lang === "ar"
                              ? "غير متوفر مسبقاً من القناة (يُحسب عند الجمع)"
                              : "Not reported by platform (counted upon collection)"
                            : undefined
                        }
                      >
                        {r.reported_comment_count !== null
                          ? r.reported_comment_count
                          : r.collected > 0
                            ? r.collected
                            : S.catCountUnknown}
                      </span>
                      <Badge
                        className="db-cat-state"
                        tone={toneOf(s)}
                        data-testid={`cat-state-${r.id}`}
                        data-state={s}
                      >
                        {state(r)}
                      </Badge>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}

          {shown.length > 0 && (
            <nav
              className="db-pager db-cat-pager"
              aria-label={S.catPage(paged.page, paged.pages)}
              data-testid="cat-pager"
            >
              <Button
                variant="secondary"
                size="sm"
                data-testid="cat-prev"
                disabled={paged.page <= 1}
                onClick={() => setPage(paged.page - 1)}
              >
                {S.catPrev}
              </Button>
              <p data-testid="cat-page">{S.catPage(paged.page, paged.pages)}</p>
              <Button
                variant="secondary"
                size="sm"
                data-testid="cat-next"
                disabled={paged.page >= paged.pages}
                onClick={() => setPage(paged.page + 1)}
              >
                {S.catNext}
              </Button>
              {paged.pages > 2 && (
                <label className="db-cat-jump">
                  {S.catJump}
                  <Input
                    type="number"
                    min={1}
                    max={paged.pages}
                    data-testid="cat-jump"
                    value={paged.page}
                    onChange={(e) => setPage(Number(e.target.value))}
                  />
                </label>
              )}
            </nav>
          )}

          <CataloguePreview
            video={previewing}
            handle={read.data?.handle}
            kindLabel={previewing ? kindWord(previewing.kind) : ""}
            onClose={() => setPreviewing(null)}
            returnTo={previewTrigger}
            S={S}
          />

          <SelectionBar
            ticked={ticked.size}
            est={est}
            remaining={remaining}
            busy={busy}
            saveDisabled={
              !dirty ||
              est.exceeds ||
              busy ||
              (mode === "live" && !effectiveChannelId)
            }
            onSave={save}
            feedback={feedback}
            S={S}
          />

          {historicalModalOpen && (
            <HistoricalImportModal
              open={historicalModalOpen}
              onClose={() => setHistoricalModalOpen(false)}
              workspaceId={workspaceId}
              channelId={effectiveChannelId}
              platform={read.data?.platform}
              plan={plan}
              onSuccess={() => {
                onChanged();
                void read.refetch();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
