/**
 * The owner console's comparison page (phase 3): every channel on the
 * platform ranked by how its audience speaks, `admin_channels_compare()`.
 *
 * Three cards name the warmest audience, the coldest, and the biggest change
 * since last week; the table ranks the rest with the analysed comments, net
 * sentiment, its weekly change and the most discussed topic. The numbers are
 * the ones the database keeps ready (recounted within minutes of a new
 * verdict), so the page reads one row per channel and never counts comments.
 * The choices live in the address and the shown rows export as CSV, as on
 * the channels console (`compareChannels.ts`).
 */
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { AdminCompareChannel } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { useLocale } from "../locale";
import { failureCode } from "../failure";
import { ChartEmpty, LoadError, Loading } from "../pageStates/PageStates";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { readAdminChannelsCompare } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";
import type { OwnerFilter } from "./channelsConsole";
import {
  MIN_SAMPLE,
  compareCsv,
  highlights,
  readCompareFilter,
  visibleCompare,
  writeCompareFilter,
  type CompareFilter,
  type CompareSort,
  type ComparedChannel,
} from "./compareChannels";

const n = (value: number) => value.toLocaleString("en-US");

export function AdminComparePage() {
  const S = useStrings();
  const { admin, shell } = useAdminShell();
  const list = useQuery({
    queryKey: ["admin", "channels", "compare"],
    queryFn: readAdminChannelsCompare,
    enabled: admin,
  });

  let body: ReactNode;
  if (!admin) body = null;
  else if (list.isPending)
    body = <Loading S={S} label={S.adminCompareLoading} shape="ops" />;
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
      <ChartEmpty testId="admin-compare-empty">
        {S.adminChannelsEmpty}
      </ChartEmpty>
    );
  else body = <Compare rows={list.data} />;

  return shell(
    <>
      <AdminPageHead title={S.adminCompareTitle} lead={S.adminCompareLead} />
      {body}
    </>,
  );
}

function Compare({ rows }: { rows: AdminCompareChannel[] }) {
  const S = useStrings();
  const [params, setParams] = useSearchParams();
  const filter = readCompareFilter(params);
  const set = (patch: Partial<CompareFilter>) =>
    setParams(writeCompareFilter({ ...filter, ...patch }), { replace: true });
  const shown = visibleCompare(rows, filter);
  const top = highlights(shown);
  // Each channel is counted on its own, so the line names the oldest count
  // and how many were never counted or keep failing (20261025000000).
  const never = rows.filter((r) => r.count_state === "never").length;
  const failing = rows.filter((r) => r.count_state === "failing").length;
  const oldest = rows.reduce<string | null>(
    (at, r) =>
      r.refreshed_at && (!at || r.refreshed_at < at) ? r.refreshed_at : at,
    null,
  );
  let rank = 0;

  function exportCsv() {
    const blob = new Blob([compareCsv(shown)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `channels-compare-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      className="db-section admin-console"
      aria-labelledby="admin-compare-heading"
    >
      <div className="admin-compare-cards" data-testid="admin-compare-cards">
        <Highlight label={S.adminCompareBest} channel={top.best}>
          {top.best && <Net value={top.best.net} />}
        </Highlight>
        <Highlight label={S.adminCompareWorst} channel={top.worst}>
          {top.worst && <Net value={top.worst.net} />}
        </Highlight>
        <Highlight label={S.adminCompareMover} channel={top.mover}>
          {top.mover && <Change value={top.mover.change} />}
        </Highlight>
      </div>

      <header>
        <h2 id="admin-compare-heading">{S.adminCompareHeading}</h2>
      </header>

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
            onChange={(e) => set({ sort: e.target.value as CompareSort })}
          >
            <option value="best">{S.adminCompareSortBest}</option>
            <option value="worst">{S.adminCompareSortWorst}</option>
            <option value="change">{S.adminCompareSortChange}</option>
            <option value="volume">{S.adminCompareSortVolume}</option>
            <option value="name">{S.adminConsoleSortName}</option>
          </select>
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={exportCsv}
          disabled={shown.length === 0}
          data-testid="admin-compare-csv"
        >
          {S.adminCompareCsv}
        </Button>
      </div>
      <p className="admin-account-muted" aria-live="polite">
        {S.adminConsoleCount(shown.length, rows.length)}
        {never > 0 && ` · ${S.adminCompareNotCounted(never)}`}
        {failing > 0 && ` · ${S.adminCompareFailingCount(failing)}`}
      </p>

      {shown.length === 0 ? (
        <ChartEmpty testId="admin-compare-none">
          {S.adminConsoleEmpty}
        </ChartEmpty>
      ) : (
        <div className="table-wrap db-admin-wrap">
          <Table data-testid="admin-compare">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{S.adminCompareRank}</TableHeaderCell>
                <TableHeaderCell>{S.adminChannelsChannel}</TableHeaderCell>
                <TableHeaderCell>{S.adminCompareAnalysed}</TableHeaderCell>
                <TableHeaderCell>{S.adminCompareNet}</TableHeaderCell>
                <TableHeaderCell>{S.adminCompareChange}</TableHeaderCell>
                <TableHeaderCell>{S.adminCompareTopic}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id} data-testid={`admin-compare-row-${c.id}`}>
                  <TableCell className="admin-home-num">
                    {c.ranked ? ++rank : null}
                  </TableCell>
                  <TableCell>
                    <ChannelLink channel={c} />
                    <span className="admin-channel-sub" dir="auto">
                      {c.mine
                        ? c.workspace_name
                        : `${c.workspace_name} · ${c.owner_email ?? ""}`}
                      {c.copies > 1 && ` · ${S.adminCompareCopies(c.copies)}`}
                    </span>
                  </TableCell>
                  <TableCell className="admin-home-num">
                    {n(c.analysed)}
                  </TableCell>
                  <TableCell>
                    {c.count_state === "never" ? (
                      <Badge tone="neutral">{S.adminCompareStateNever}</Badge>
                    ) : c.refreshed_at === null ? (
                      <CountFailed channel={c} />
                    ) : c.ranked ? (
                      <Net value={c.net} />
                    ) : (
                      <Badge tone="neutral">{S.adminCompareSmall}</Badge>
                    )}
                    {c.count_state === "failing" && c.refreshed_at !== null && (
                      <CountFailed channel={c} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Change value={c.change} />
                  </TableCell>
                  <TableCell>
                    <Topic channel={c} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="admin-account-muted">
        {S.adminCompareHow(MIN_SAMPLE)}
        {oldest &&
          ` ${S.adminCompareRefreshed(oldest.slice(0, 16).replace("T", " "))}`}
      </p>
    </section>
  );
}

/** A channel whose count keeps failing: the error and the next attempt. */
function CountFailed({ channel }: { channel: ComparedChannel }) {
  const S = useStrings();
  const next = channel.next_attempt_at
    ? channel.next_attempt_at.slice(0, 16).replace("T", " ")
    : null;
  return (
    <Badge
      tone="danger"
      title={S.adminCompareFailingTitle(channel.count_error ?? "", next)}
      data-testid={`admin-compare-failing-${channel.id}`}
    >
      {S.adminCompareStateFailing}
    </Badge>
  );
}

function Highlight({
  label,
  channel,
  children,
}: {
  label: string;
  channel: ComparedChannel | null;
  children: ReactNode;
}) {
  const S = useStrings();
  return (
    <Card className="admin-compare-card">
      <h3>{label}</h3>
      {channel ? (
        <>
          <ChannelLink channel={channel} />
          <span className="admin-compare-card-value">{children}</span>
        </>
      ) : (
        <p className="admin-account-muted">{S.adminCompareNoneYet}</p>
      )}
    </Card>
  );
}

/** A channel's name, linking to its row in the channels console. */
function ChannelLink({ channel: c }: { channel: ComparedChannel }) {
  const S = useStrings();
  return (
    <Link
      className="admin-console-name"
      to={`/admin/channels?q=${encodeURIComponent(c.external_channel_id)}`}
      aria-label={S.adminCompareOpen(c.name)}
    >
      <span dir="auto">{c.name}</span>
    </Link>
  );
}

function Net({ value }: { value: number | null }) {
  const S = useStrings();
  if (value === null) return <span className="admin-account-muted">—</span>;
  return (
    <span
      className={`admin-compare-net ${value >= 0 ? "is-positive" : "is-negative"}`}
    >
      {S.adminComparePercent(value)}
    </span>
  );
}

function Change({ value }: { value: number | null }) {
  const S = useStrings();
  if (value === null) return <span className="admin-account-muted">—</span>;
  return (
    <span
      className={`admin-compare-net ${value >= 0 ? "is-positive" : "is-negative"}`}
    >
      {S.adminComparePoints(value)}
    </span>
  );
}

function Topic({ channel: c }: { channel: ComparedChannel }) {
  const lang = useLocale();
  if (!c.top_topic) return <span className="admin-account-muted">—</span>;
  return (
    <span dir="auto">
      {lang === "en" ? c.top_topic.name_en : c.top_topic.name_ar}
    </span>
  );
}
