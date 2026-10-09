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
 * Read only in this phase; bulk actions and the pause state are phase 2.
 */
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { AdminConsoleChannel } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { ChartEmpty, LoadError, Loading } from "../pageStates/PageStates";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";
import { Input } from "../ui/Input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { readAdminChannelsConsole } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";
import {
  STATE_ORDER,
  STATE_TONE,
  channelName,
  readFilter,
  scoped,
  stateCounts,
  visibleChannels,
  writeFilter,
  type ConsoleFilter,
  type OwnerFilter,
  type SortKey,
} from "./channelsConsole";

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
  const openIndex = shown.findIndex((c) => c.id === openId);

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

      {shown.length === 0 ? (
        <ChartEmpty testId="admin-console-empty">
          {S.adminConsoleEmpty}
        </ChartEmpty>
      ) : (
        <div className="table-wrap db-admin-wrap">
          <Table data-testid="admin-channels">
            <TableHead>
              <TableRow>
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
                  <TableCell>
                    <button
                      type="button"
                      className="admin-console-name"
                      onClick={() => setOpenId(c.id)}
                      aria-label={S.adminConsoleOpen(channelName(c))}
                    >
                      <span dir="auto">{channelName(c)}</span>
                    </button>
                    <span className="admin-channel-sub" dir="auto">
                      {c.mine
                        ? c.workspace_name
                        : `${c.workspace_name} · ${c.owner_email ?? ""}`}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATE_TONE[c.state]}>
                      {S.adminChannelStates[c.state] ?? c.state}
                    </Badge>
                    {c.last_error && (
                      <span className="admin-channel-error">
                        {c.last_error}
                      </span>
                    )}
                  </TableCell>
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
}: {
  channel: AdminConsoleChannel | null;
  position: number;
  count: number;
  onClose: () => void;
  onMove: (step: 1 | -1) => void;
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
                <span dir="auto">{channelName(c)}</span>
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
            >
              {S.adminHomeOpenWorkspace}
            </Link>
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
