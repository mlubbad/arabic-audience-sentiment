/**
 * The owner console's channels page (phase 1b): every channel on the
 * platform with the state the home counts, `admin_channels_console()`.
 *
 * Built for a hundred channels and more: state chips with their counts,
 * an account filter (the owner's own workspaces or the customers'), a search
 * box that folds Arabic letter forms, and an order with trouble first. The
 * choice lives in the address (`channelsConsole.ts`), so the home links
 * straight to the channels in a state. A row opens the channel's details
 * beside the list, with the way into its workspace and the next and previous
 * channel, so the owner walks the list without leaving it.
 *
 * The panel pauses and resumes a channel's collection
 * (`admin_set_channels_paused`); bulk actions over a selection follow.
 */
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminConsoleChannel } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { ChartEmpty, LoadError, Loading } from "../pageStates/PageStates";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { useMediaQuery } from "../ui/useMediaQuery";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import {
  readAdminChannelsConsole,
  requestChannelWork,
  setAutoSelection,
  setChannelsPaused,
} from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";
import {
  STATE_ORDER,
  STATE_TONE,
  channelLabel,
  channelsCsv,
  readFilter,
  scoped,
  stateCounts,
  visibleChannels,
  writeFilter,
  type ConsoleFilter,
  type OwnerFilter,
  type SortKey,
} from "./channelsConsole";
import { saveTrail } from "./adminTrail";

const n = (value: number) => value.toLocaleString("en-US");
const when = (iso: string | null) =>
  iso ? iso.slice(0, 16).replace("T", " ") : null;

export function AdminChannelsPage() {
  const S = useStrings();
  const { admin, shell } = useAdminShell();
  const list = useQuery({
    queryKey: ["admin", "channels", "console"],
    queryFn: readAdminChannelsConsole,
    enabled: admin,
  });

  let body: ReactNode;
  if (!admin) body = null;
  else if (list.isPending)
    body = <Loading S={S} label={S.adminChannelsLoading} shape="ops" />;
  else if (list.isError)
    body = (
      <LoadError
        S={S}
        message={S.serviceUnreachable}
        failure={failureCode("read", list.error)}
        onRetry={() => void list.refetch()}
      />
    );
  else if (list.data.length === 0)
    body = (
      <ChartEmpty testId="admin-channels-empty">
        {S.adminChannelsEmpty}
      </ChartEmpty>
    );
  else body = <Console rows={list.data} />;

  return shell(
    <>
      <AdminPageHead title={S.adminChannelsTitle} lead={S.adminChannelsLead} />
      {body}
    </>,
  );
}

function Console({ rows }: { rows: AdminConsoleChannel[] }) {
  const S = useStrings();
  const [params, setParams] = useSearchParams();
  const filter = readFilter(params);
  const set = (patch: Partial<ConsoleFilter>) =>
    setParams(writeFilter({ ...filter, ...patch }), { replace: true });
  const counts = stateCounts(scoped(rows, filter));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shown = visibleChannels(rows, filter);
  const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // Only channels still in the list count: a row that left it (deleted, or
  // a fresh read) is never acted on by a selection made before.
  const chosen = rows.filter((c) => picked.has(c.id));
  const allShown = shown.length > 0 && shown.every((c) => picked.has(c.id));
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const openIndex = shown.findIndex((c) => c.id === openId);
  const phone = useMediaQuery("(max-width: 640px)");

  // The pieces a row shows, the same whether it is a table row or a card.
  const selectAll = (
    <Checkbox
      label={S.adminBulkSelectAll}
      hideLabel
      checked={allShown}
      onCheckedChange={(on) =>
        setPicked((prev) => {
          const next = new Set(prev);
          for (const c of shown)
            if (on === true) next.add(c.id);
            else next.delete(c.id);
          return next;
        })
      }
    />
  );
  const pick = (c: AdminConsoleChannel) => (
    <Checkbox
      label={S.adminBulkSelect(channelLabel(c, S))}
      hideLabel
      checked={picked.has(c.id)}
      onCheckedChange={(on) => toggle(c.id, on === true)}
    />
  );
  const name = (c: AdminConsoleChannel) => (
    <button
      type="button"
      className="admin-console-name"
      onClick={() => setOpenId(c.id)}
      aria-label={S.adminConsoleOpen(channelLabel(c, S))}
    >
      <span dir="auto">{channelLabel(c, S)}</span>
    </button>
  );
  const where = (c: AdminConsoleChannel) => (
    <span className="admin-channel-sub" dir="auto">
      {c.mine
        ? c.workspace_name
        : `${c.workspace_name} · ${c.owner_email ?? ""}`}
    </span>
  );
  const state = (c: AdminConsoleChannel) => (
    <>
      <Badge tone={STATE_TONE[c.state]}>
        {S.adminChannelStates[c.state] ?? c.state}
      </Badge>
      {c.last_error && (
        <span className="admin-channel-error">{c.last_error}</span>
      )}
    </>
  );

  return (
    <section
      className="db-section admin-console"
      aria-labelledby="admin-channels-heading"
    >
      <header>
        <h2 id="admin-channels-heading">{S.adminChannelsHeading}</h2>
      </header>

      <div
        className="admin-console-states"
        role="group"
        aria-label={S.adminHomeStates}
        data-testid="admin-console-states"
      >
        <button
          type="button"
          aria-pressed={filter.state === "all"}
          onClick={() => set({ state: "all" })}
        >
          {S.adminConsoleAll} <span className="admin-home-num">{n(total)}</span>
        </button>
        {STATE_ORDER.map((state) => (
          <button
            key={state}
            type="button"
            aria-pressed={filter.state === state}
            onClick={() => set({ state })}
            data-testid={`admin-console-state-${state}`}
          >
            {S.adminChannelStates[state] ?? state}{" "}
            <span className="admin-home-num">{n(counts[state])}</span>
          </button>
        ))}
      </div>

      <div className="admin-console-bar">
        <Input
          type="search"
          aria-label={S.adminConsoleSearch}
          placeholder={S.adminConsoleSearch}
          value={filter.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        <label className="admin-console-select">
          <span>{S.adminConsoleOwnerLabel}</span>
          <select
            value={filter.owner}
            onChange={(e) => set({ owner: e.target.value as OwnerFilter })}
          >
            <option value="all">{S.adminConsoleOwnerAll}</option>
            <option value="mine">{S.adminConsoleOwnerMine}</option>
            <option value="customers">{S.adminConsoleOwnerCustomers}</option>
          </select>
        </label>
        <label className="admin-console-select">
          <span>{S.adminConsoleSortLabel}</span>
          <select
            value={filter.sort}
            onChange={(e) => set({ sort: e.target.value as SortKey })}
          >
            <option value="state">{S.adminConsoleSortState}</option>
            <option value="name">{S.adminConsoleSortName}</option>
            <option value="comments">{S.adminConsoleSortComments}</option>
            <option value="oldest">{S.adminConsoleSortOldest}</option>
          </select>
        </label>
      </div>
      <p className="admin-account-muted" aria-live="polite">
        {S.adminConsoleCount(shown.length, rows.length)}
      </p>

      {chosen.length > 0 && (
        <BulkBar channels={chosen} onClear={() => setPicked(new Set())} />
      )}

      {shown.length === 0 ? (
        <ChartEmpty testId="admin-console-empty">
          {S.adminConsoleEmpty}
        </ChartEmpty>
      ) : phone ? (
        // A card per channel under 640px: as a table only the name column
        // fitted a phone, and the state, counts and last success were cut off
        // (owner console review, 2026-10-13, finding 13).
        <div className="admin-console-cards" data-testid="admin-channels">
          <div className="admin-console-cards-all">{selectAll}</div>
          {shown.map((c) => (
            <Card
              key={c.id}
              className="admin-console-card"
              data-testid={`admin-console-row-${c.id}`}
            >
              <div className="admin-console-card-head">
                {pick(c)}
                <div>
                  {name(c)}
                  {where(c)}
                </div>
              </div>
              {state(c)}
              <dl className="admin-console-card-facts">
                <div>
                  <dt>{S.adminConsoleVideos}</dt>
                  <dd>
                    {n(c.videos)} · {n(c.selected)}
                  </dd>
                </div>
                <div>
                  <dt>{S.adminChannelsComments}</dt>
                  <dd>{n(c.comments)}</dd>
                </div>
                <div>
                  <dt>{S.adminHomeLastOk}</dt>
                  <dd>{when(c.last_ok_at) ?? S.adminHomeNever}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      ) : (
        <div className="table-wrap db-admin-wrap">
          <Table data-testid="admin-channels">
            <TableHead>
              <TableRow>
                <TableHeaderCell className="admin-console-check">
                  {selectAll}
                </TableHeaderCell>
                <TableHeaderCell>{S.adminChannelsChannel}</TableHeaderCell>
                <TableHeaderCell>{S.adminChannelsStatus}</TableHeaderCell>
                <TableHeaderCell>{S.adminConsoleVideos}</TableHeaderCell>
                <TableHeaderCell>{S.adminChannelsComments}</TableHeaderCell>
                <TableHeaderCell>{S.adminHomeLastOk}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id} data-testid={`admin-console-row-${c.id}`}>
                  <TableCell className="admin-console-check">
                    {pick(c)}
                  </TableCell>
                  <TableCell>
                    {name(c)}
                    {where(c)}
                  </TableCell>
                  <TableCell>{state(c)}</TableCell>
                  <TableCell>
                    {n(c.videos)} · {n(c.selected)}
                  </TableCell>
                  <TableCell>{n(c.comments)}</TableCell>
                  <TableCell>
                    {when(c.last_ok_at) ?? S.adminHomeNever}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ChannelPanel
        channel={openIndex >= 0 ? shown[openIndex]! : null}
        position={openIndex}
        count={shown.length}
        onEnter={() =>
          saveTrail({
            back: `/admin/channels${params.size ? `?${params}` : ""}`,
            items: shown.map((c) => ({
              workspace_id: c.workspace_id,
              name: channelLabel(c, S),
            })),
          })
        }
        onClose={() => setOpenId(null)}
        onMove={(step) => setOpenId(shown[openIndex + step]?.id ?? openId)}
      />
    </section>
  );
}

function ChannelPanel({
  channel: c,
  position,
  count,
  onClose,
  onMove,
  onEnter,
}: {
  channel: AdminConsoleChannel | null;
  position: number;
  count: number;
  onClose: () => void;
  onMove: (step: 1 | -1) => void;
  /** Keeps the list as shown, for the way back and on (`adminTrail.ts`). */
  onEnter: () => void;
}) {
  const S = useStrings();
  return (
    <Dialog open={c !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        variant="sheet"
        closeLabel={S.adminConsolePanelClose}
        className="admin-account-sheet"
        aria-describedby={undefined}
        data-testid="admin-console-panel"
      >
        {c && (
          <div className="admin-account">
            <header className="admin-account-head">
              <DialogTitle>
                <span dir="auto">{channelLabel(c, S)}</span>
              </DialogTitle>
              {c.handle && <small dir="ltr">{c.handle}</small>}
              <div className="admin-account-chips">
                <Badge tone={STATE_TONE[c.state]}>
                  {S.adminChannelStates[c.state] ?? c.state}
                </Badge>
              </div>
            </header>
            <dl className="admin-account-facts">
              <dt>{S.adminChannelsWorkspace}</dt>
              <dd dir="auto">{c.workspace_name}</dd>
              <dt>{S.adminConsoleOwner}</dt>
              <dd dir="auto">
                {c.mine ? S.adminConsoleYou : (c.owner_email ?? "—")}
              </dd>
              <dt>{S.adminConsoleExternal}</dt>
              <dd dir="ltr">{c.external_channel_id}</dd>
              <dt>{S.adminConsoleCatalogued}</dt>
              <dd>{when(c.catalogued_at) ?? S.adminHomeNever}</dd>
              <dt>{S.adminHomeLastOk}</dt>
              <dd>{when(c.last_ok_at) ?? S.adminHomeNever}</dd>
              {c.last_error && (
                <>
                  <dt>{S.adminConsoleLastError}</dt>
                  <dd>
                    <code className="admin-home-error">{c.last_error}</code>
                  </dd>
                </>
              )}
              <dt>{S.adminHomeVideos}</dt>
              <dd>{n(c.videos)}</dd>
              <dt>{S.adminHomeSelected}</dt>
              <dd>{n(c.selected)}</dd>
              <dt>{S.adminHomeComments}</dt>
              <dd>{n(c.comments)}</dd>
              <dt>{S.adminHomeAnalysed}</dt>
              <dd>{n(c.analysed)}</dd>
              <dt>{S.adminConsoleAuto}</dt>
              <dd>
                {c.auto_initial !== null && c.auto_daily !== null
                  ? S.adminConsoleAutoValue(c.auto_initial, c.auto_daily)
                  : S.adminConsoleAutoNone}
              </dd>
            </dl>
            <Link
              to={`/dashboard?ws=${c.workspace_id}`}
              className="ui-btn ui-btn--primary ui-btn--sm admin-console-enter"
              onClick={onEnter}
            >
              {S.adminHomeOpenWorkspace}
            </Link>
            <PauseControl key={c.id} channel={c} />
            <div className="admin-console-nav">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={position <= 0}
                onClick={() => onMove(-1)}
              >
                {S.adminConsolePrev}
              </Button>
              <span className="admin-account-muted">
                {S.adminConsolePosition(position + 1, count)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={position >= count - 1}
                onClick={() => onMove(1)}
              >
                {S.adminConsoleNext}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Pause or resume one channel's collection: a pause asks for a second,
 *  confirming press; resuming does not, since it only lets work start. */
function PauseControl({ channel: c }: { channel: AdminConsoleChannel }) {
  const S = useStrings();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const paused = c.state === "paused";

  async function change(pause: boolean) {
    setBusy(true);
    setNote(null);
    setConfirming(false);
    try {
      await setChannelsPaused([c.id], pause);
      setNote({
        ok: true,
        text: pause ? S.adminConsolePausedDone : S.adminConsoleResumedDone,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "channels", "console"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "overview"] }),
      ]);
    } catch {
      setNote({ ok: false, text: S.adminConsolePauseFailed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="admin-account-section"
      data-testid="admin-console-pause"
    >
      <p className="admin-account-callout">{S.adminConsolePauseNote}</p>
      {note && (
        <p
          role={note.ok ? "status" : "alert"}
          className={note.ok ? "admin-account-ok" : "admin-account-error"}
        >
          {note.text}
        </p>
      )}
      <div className="admin-account-row">
        {paused ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void change(false)}
          >
            {S.adminConsoleResume}
          </Button>
        ) : confirming ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => void change(true)}
            >
              {S.adminConsolePauseConfirm}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              {S.adminAccountCancel}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {S.adminConsolePause}
          </Button>
        )}
      </div>
    </section>
  );
}

/** What the owner can do to every selected channel at once. Each action is
 *  one server call over the list, audited per channel on the server; a
 *  pause asks for a confirming press, as it does for one channel. */
function BulkBar({
  channels,
  onClear,
}: {
  channels: AdminConsoleChannel[];
  onClear: () => void;
}) {
  const S = useStrings();
  const queryClient = useQueryClient();
  const ids = channels.map((c) => c.id);
  const [busy, setBusy] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [initial, setInitial] = useState("20");
  const [daily, setDaily] = useState("5");
  const [note, setNote] = useState<{
    ok: boolean;
    /** Done, but nothing was queued: not a success to show in green. */
    none?: boolean;
    text: string;
  } | null>(null);

  async function run(
    action: () => Promise<string | { text: string; none: boolean }>,
  ) {
    setBusy(true);
    setNote(null);
    setConfirmPause(false);
    try {
      const done = await action();
      setNote(
        typeof done === "string"
          ? { ok: true, text: done }
          : { ok: true, none: done.none, text: done.text },
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "channels", "console"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "overview"] }),
      ]);
    } catch {
      setNote({ ok: false, text: S.adminBulkFailed });
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const blob = new Blob([channelsCsv(channels)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `channels-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const initialN = Number(initial);
  const dailyN = Number(daily);
  const numbersOk =
    Number.isInteger(initialN) &&
    initialN >= 0 &&
    initialN <= 200 &&
    Number.isInteger(dailyN) &&
    dailyN >= 0 &&
    dailyN <= 100;

  return (
    <section
      className="admin-bulk"
      aria-label={S.adminBulkSelected(channels.length)}
      data-testid="admin-bulk"
    >
      <strong>{S.adminBulkSelected(channels.length)}</strong>
      <div className="admin-account-row">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await requestChannelWork(ids, "collect");
              return {
                text: S.adminBulkQueued(r.queued, r.skipped),
                none: r.queued === 0,
              };
            })
          }
        >
          {S.adminBulkCollect}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await requestChannelWork(ids, "discover");
              return {
                text: S.adminBulkQueued(r.queued, r.skipped),
                none: r.queued === 0,
              };
            })
          }
        >
          {S.adminBulkCatalogue}
        </Button>
        {confirmPause ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await setChannelsPaused(ids, true);
                return S.adminBulkPaused(r.changed, r.cancelled_jobs);
              })
            }
          >
            {S.adminBulkPauseConfirm(channels.length)}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmPause(true)}
          >
            {S.adminBulkPause}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await setChannelsPaused(ids, false);
              return S.adminBulkResumed(r.changed);
            })
          }
        >
          {S.adminBulkResume}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={autoOpen}
          onClick={() => setAutoOpen((o) => !o)}
        >
          {S.adminBulkAuto}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={exportCsv}>
          {S.adminBulkExport}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          {S.adminBulkClear}
        </Button>
      </div>
      {autoOpen && (
        <form
          className="admin-bulk-auto"
          onSubmit={(e) => {
            e.preventDefault();
            if (!numbersOk) return;
            void run(async () => {
              const r = await setAutoSelection(ids, initialN, dailyN);
              return S.adminBulkAutoDone(r.changed);
            });
          }}
        >
          <p className="admin-account-callout">{S.adminBulkAutoNote}</p>
          <div className="admin-account-grid">
            <div className="ui-field">
              <label htmlFor="bulk-initial">{S.adminBulkAutoInitial}</label>
              <Input
                id="bulk-initial"
                type="number"
                min={0}
                max={200}
                step={1}
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
              />
            </div>
            <div className="ui-field">
              <label htmlFor="bulk-daily">{S.adminBulkAutoDaily}</label>
              <Input
                id="bulk-daily"
                type="number"
                min={0}
                max={100}
                step={1}
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
              />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={busy || !numbersOk}>
            {S.adminBulkAutoApply}
          </Button>
        </form>
      )}
      {note && (
        <p
          role={note.ok ? "status" : "alert"}
          className={
            !note.ok
              ? "admin-account-error"
              : note.none
                ? "admin-account-muted"
                : "admin-account-ok"
          }
          data-testid="admin-bulk-note"
        >
          {note.text}
        </p>
      )}
    </section>
  );
}
