/**
 * Every channel in the platform: the workspace it feeds, how much has been
 * collected through it, and the verdict of its last sync run. The row is
 * coloured by the state the row itself says — connected, waiting for a
 * first sync, or one that failed — the way the operations page colours a
 * channel the workspace's own reader knows.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminChannel } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { ChartEmpty, LoadError, Loading } from "../pageStates/PageStates";
import { Badge } from "../ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { readAdminChannels } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";

const NONE = "—";
export const COLLECTION_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/** The channel's own status vocabulary, as the foundation migration states
 *  it. The first two are fine; the last two are the operator's work. */
function statusTone(status: string): "success" | "danger" | "neutral" {
  if (status === "connected") return "success";
  if (status === "reconnect_required" || status === "disconnected")
    return "danger";
  return "neutral";
}

export function AdminChannelsPage() {
  const S = useStrings();
  const { admin, shell } = useAdminShell();
  const list = useQuery({
    queryKey: ["admin", "channels"],
    queryFn: readAdminChannels,
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
  else
    body = (
      <section className="db-section" aria-labelledby="admin-channels-heading">
        <header>
          <h2 id="admin-channels-heading">{S.adminChannelsHeading}</h2>
        </header>
        <div className="table-wrap db-admin-wrap">
          <Table data-testid="admin-channels">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{S.adminChannelsChannel}</TableHeaderCell>
                <TableHeaderCell>{S.adminChannelsWorkspace}</TableHeaderCell>
                <TableHeaderCell>{S.adminChannelsStatus}</TableHeaderCell>
                <TableHeaderCell>{S.adminChannelsVideos}</TableHeaderCell>
                <TableHeaderCell>{S.adminChannelsComments}</TableHeaderCell>
                <TableHeaderCell>{S.adminChannelsLastSync}</TableHeaderCell>
                <TableHeaderCell>
                  {S.adminChannelsLastSuccessfulCollection}
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.data.map((c) => (
                <ChannelRow key={c.id} channel={c} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    );

  return shell(
    <>
      <AdminPageHead title={S.adminChannelsTitle} lead={S.adminChannelsLead} />
      {body}
    </>,
  );
}

function ChannelRow({ channel }: { channel: AdminChannel }) {
  const S = useStrings();
  const name = channel.title ?? channel.handle ?? channel.external_channel_id;
  const sync =
    channel.last_sync_at === null
      ? S.adminChannelsNeverSynced
      : `${channel.last_sync_at.slice(0, 10)} · ${channel.last_sync_status ?? NONE}`;
  const collectionAge =
    channel.last_collect_ok_at === null
      ? null
      : compactAge(Date.now() - Date.parse(channel.last_collect_ok_at));
  const collectionIsStale =
    channel.status === "connected" &&
    (channel.last_collect_ok_at === null ||
      Date.now() - Date.parse(channel.last_collect_ok_at) >
        COLLECTION_STALE_AFTER_MS);
  return (
    <TableRow>
      <TableCell>
        <span className="admin-channel-name">{name}</span>
        {channel.handle ? (
          <span className="admin-channel-sub">{channel.handle}</span>
        ) : null}
        {channel.last_sync_error ? (
          <span className="admin-channel-error">{channel.last_sync_error}</span>
        ) : null}
      </TableCell>
      <TableCell>{channel.workspace_name}</TableCell>
      <TableCell>
        <Badge tone={statusTone(channel.status)}>
          {channelStatus(channel.status, S)}
        </Badge>
      </TableCell>
      <TableCell>{channel.video_count}</TableCell>
      <TableCell>{channel.comment_count}</TableCell>
      <TableCell>{sync}</TableCell>
      <TableCell>
        {channel.last_collect_ok_at === null ? (
          S.adminChannelsNeverCollected
        ) : (
          <time
            dateTime={channel.last_collect_ok_at}
            title={channel.last_collect_ok_at}
          >
            {collectionAge}
          </time>
        )}
        {collectionIsStale ? (
          <Badge tone="warning">{S.adminChannelsCollectionStale}</Badge>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function compactAge(ageMs: number): string {
  const hours = Math.max(0, Math.floor(ageMs / (60 * 60 * 1000)));
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

function channelStatus(
  status: string,
  S: ReturnType<typeof useStrings>,
): string {
  switch (status) {
    case "connected":
      return S.adminChannelsConnected;
    case "public_unverified":
      return S.adminChannelsUnverified;
    case "reconnect_required":
      return S.adminChannelsReconnect;
    case "disconnected":
      return S.adminChannelsDisconnected;
    default:
      return status;
  }
}
