/**
 * The owner console's home (phase 1, owner approval 2026-10-09): the whole
 * platform in one read, `admin_console_overview()`.
 *
 * Four parts, in the order the owner needs them: the size of the platform,
 * the state of every channel, what needs the owner (failing and stale
 * channels, each with the way into its workspace), and what happened lately.
 * No quota meters: nothing in the database measures YouTube or Apify units
 * yet, and a meter would be a claim the page cannot back.
 *
 * The demo (`?demo=1`) has no server to read, so it goes on to the
 * workspaces demo, the admin area's only demo.
 */
import type { ReactNode } from "react";
import { Link, Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { AdminConsoleOverview } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { LoadError, Loading } from "../pageStates/PageStates";
import { readAdminConsoleOverview } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";
import { STATE_ORDER, STATE_TONE } from "./channelsConsole";

const n = (value: number) => value.toLocaleString("en-US");
const when = (iso: string | null) =>
  iso ? iso.slice(0, 16).replace("T", " ") : null;

export function AdminHomePage() {
  const S = useStrings();
  const demo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");
  const { admin, shell } = useAdminShell();
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: readAdminConsoleOverview,
    enabled: admin && !demo,
  });
  if (demo) return <Navigate to="/admin/workspaces?demo=1" replace />;

  let body: ReactNode;
  if (!admin) body = null;
  else if (overview.isPending)
    body = <Loading S={S} label={S.adminHomeLoading} shape="ops" />;
  else if (overview.isError)
    body = (
      <LoadError
        S={S}
        message={S.serviceUnreachable}
        failure={failureCode("read", overview.error)}
        onRetry={() => void overview.refetch()}
      />
    );
  else body = <Overview o={overview.data} />;

  return shell(
    <>
      <AdminPageHead title={S.adminHomeTitle} lead={S.adminHomeLead} />
      {body}
    </>,
  );
}

function Overview({ o }: { o: AdminConsoleOverview }) {
  const S = useStrings();
  const analysedShare =
    o.funnel.comments > 0
      ? Math.round((o.funnel.analysed / o.funnel.comments) * 100)
      : null;
  return (
    <div className="admin-home" data-testid="admin-home">
      <section className="admin-home-tiles" aria-label={S.adminHomeTitle}>
        <Tile label={S.adminHomeChannels} value={n(o.channels)} />
        <Tile label={S.adminHomeWorkspaces} value={n(o.workspaces)} />
        <Tile label={S.adminHomeUsers} value={n(o.users)} />
        <Tile label={S.adminHomeComments} value={n(o.funnel.comments)} />
        <Tile
          label={S.adminHomeAnalysed}
          value={n(o.funnel.analysed)}
          note={analysedShare === null ? undefined : `${analysedShare}%`}
        />
        <Tile
          label={S.adminHomeWorker}
          value={
            o.worker.fresh ? S.adminHomeWorkerFresh : S.adminHomeWorkerStale
          }
          note={S.adminHomeQueue(o.worker.queued, o.worker.running)}
          tone={o.worker.fresh ? undefined : "danger"}
        />
      </section>

      <div className="admin-home-grid">
        <Card className="admin-home-card">
          <h2>{S.adminHomeStates}</h2>
          <ul className="admin-home-states" data-testid="admin-home-states">
            {STATE_ORDER.map((state) => (
              <li key={state}>
                <Link to={`/admin/channels?state=${state}`}>
                  <Badge tone={STATE_TONE[state]}>
                    {S.adminChannelStates[state] ?? state}
                  </Badge>
                  <span className="admin-home-num">{n(o.states[state])}</span>
                </Link>
              </li>
            ))}
          </ul>
          <h2>{S.adminHomeFunnel}</h2>
          <dl className="admin-home-funnel">
            <dt>{S.adminHomeVideos}</dt>
            <dd>{n(o.funnel.videos)}</dd>
            <dt>{S.adminHomeSelected}</dt>
            <dd>{n(o.funnel.selected)}</dd>
            <dt>{S.adminHomeComments}</dt>
            <dd>{n(o.funnel.comments)}</dd>
            <dt>{S.adminHomeAnalysed}</dt>
            <dd>{n(o.funnel.analysed)}</dd>
          </dl>
        </Card>

        <Card className="admin-home-card">
          <h2>{S.adminHomeAttention}</h2>
          {o.attention.length === 0 ? (
            <p className="admin-account-muted">{S.adminHomeAttentionEmpty}</p>
          ) : (
            <ul
              className="admin-home-attention"
              data-testid="admin-home-attention"
            >
              {o.attention.map((a) => (
                <li key={a.channel_id}>
                  <div>
                    <strong dir="auto">
                      {a.title ?? a.handle ?? a.workspace_name}
                    </strong>
                    <Badge tone={STATE_TONE[a.state]}>
                      {S.adminChannelStates[a.state] ?? a.state}
                    </Badge>
                    {a.error_code && (
                      <code className="admin-home-error">{a.error_code}</code>
                    )}
                  </div>
                  <small className="admin-account-muted">
                    {S.adminHomeLastOk}:{" "}
                    {when(a.last_ok_at) ?? S.adminHomeNever}
                  </small>
                  <Link to={`/dashboard?ws=${a.workspace_id}`}>
                    {S.adminHomeOpenWorkspace}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="admin-home-card">
          <h2>{S.adminHomeActivity}</h2>
          {o.activity.length === 0 ? (
            <p className="admin-account-muted">{S.adminHomeActivityEmpty}</p>
          ) : (
            <ol
              className="admin-account-history"
              data-testid="admin-home-activity"
            >
              {o.activity.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <time dateTime={e.at}>{when(e.at)}</time>
                  <span>
                    {S.adminAccountActions[e.action] ?? e.action}
                    {e.workspace_name && (
                      <span dir="auto"> · {e.workspace_name}</span>
                    )}
                    {e.actor_email && (
                      <small className="admin-account-muted">
                        {" "}
                        {S.adminAccountHistoryBy(e.actor_email)}
                      </small>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "danger";
}) {
  return (
    <Card
      className={`admin-home-tile${tone ? ` admin-home-tile--${tone}` : ""}`}
    >
      <span className="admin-home-tile-label">{label}</span>
      <strong className="admin-home-tile-value">{value}</strong>
      {note && <span className="admin-home-tile-note">{note}</span>}
    </Card>
  );
}
