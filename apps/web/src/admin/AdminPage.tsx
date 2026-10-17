/**
 * The operator's own screen: every workspace, the plan it is on, and the
 * hand levers the handoff describes — set a plan for some months, grant a
 * pack of units, delete.
 *
 * The door is `is_platform_admin()`, read through the same hook the rail's
 * link reads, so a reader who is not an admin sees one sentence and no
 * table. The table is `admin_workspaces()`, which refuses a non-admin on the
 * server as well: hiding the page is a courtesy, the database is the gate.
 *
 * `?demo=1` is the other way in, the way `/sync?demo=1` is: no session, no
 * gate, the six rows of `public/fixtures/admin.json` in local state, and
 * every lever replayed through `reduceAdminDemo` — which refuses exactly
 * what the migrations refuse, in the same shape, so the row says the same
 * sentence the live page would. The browser suite drives the operator's
 * page on it without a server. The demo's rows are read through react-query
 * (so pending and failed reads render as every other page's do) and copied
 * into `useState` on first success; from then on the reducer owns them.
 *
 * `AdminPage.tsx`, not `Admin.tsx`: `adminWords.ts` and `adminAccess.ts` sit
 * beside its old path, and on a case-insensitive filesystem a bare `./Admin`
 * would be one import away from resolving to the wrong file.
 */
import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminWorkspacesSchema,
  type AdminWorkspace,
} from "@sentiment/contracts";
import { supabase } from "../supabase";
import { useSession } from "../session";
import { useIsPlatformAdmin } from "../adminAccess";
import { useImpersonation } from "../impersonation";
import { useAdminPlanCatalogue } from "../planCatalogue";
import { fixtureCatalogue } from "../data";
import { useLocale } from "../locale";
import { adminErrorMessage, adminPlanOptions, adminRows } from "../adminWords";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { useMediaQuery } from "../ui/useMediaQuery";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
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
import { ChartEmpty, Loading, LoadError } from "../pageStates/PageStates";
import type { Footprint } from "../DeleteWorkspaceDialog";
import { AdminTabs } from "./AdminShell";
import { DEMO_USERS, loadAdminDemo, reduceAdminDemo } from "./adminDemo";
import { readAdminAccounts } from "./adminRead";
import { fold } from "./AdminCommandPalette";
import { WorkspaceRow, type AdminAction } from "./WorkspaceRow";
import "../pages.css";
import "./admin.css";

export async function readWorkspaces() {
  const { data, error } = await supabase!.rpc("admin_workspaces");
  // Thrown as it came: the sentence is chosen where it is shown, from the
  // code alone — never from the text, which can carry the request URL.
  if (error) throw error;
  return AdminWorkspacesSchema.parse(data);
}

/** The three RPCs, called with the row's action as their argument list.
 *  Exported for its test: the one place the row's `plan_key` becomes the
 *  RPC's `plan`. */
export async function callServer(action: AdminAction): Promise<void> {
  const db = supabase!;
  const { error } =
    action.type === "set_plan"
      ? await db.rpc("set_workspace_plan", {
          w: action.w,
          plan: action.plan_key,
          months: action.months,
          note: action.note,
          override: action.override,
        })
      : action.type === "grant_pack"
        ? await db.rpc("grant_pack", {
            w: action.w,
            kind: action.kind,
            units: action.units,
            note: action.note,
          })
        : await db.rpc("delete_workspace", { w: action.w });
  if (error) throw error;
}

/** What the demo's delete dialog counts. The fixture has no channels or
 *  comments to count, so the figures are illustrative — sized by the row's
 *  ordinal so no two dialogs say the same thing, and zero for the workspace
 *  that never had a plan. */
function demoFootprint(w: AdminWorkspace): Footprint {
  const n = Number(w.id.slice(-2)) || 1;
  if (w.plan_key === null)
    return {
      channels: 0,
      videos: 0,
      comments: 0,
      predictions: 0,
      reviews: 0,
      members: 1,
    };
  return {
    channels: 1,
    videos: 12 * n,
    comments: 640 * n,
    predictions: 600 * n,
    reviews: 3 * n,
    members: n === 1 ? 1 : 2,
  };
}

const DEMO_OWNERS: Owners = new Map(DEMO_USERS.map((u) => [u.id, u.email]));

const DEMO_PLAN_KEYS: ReadonlySet<string> = new Set(
  fixtureCatalogue.map((p) => p.key),
);

export function AdminPage() {
  const S = useStrings();
  // An explicit way in to the demo of this page — the same test `ops/Sync.tsx`
  // makes for `/sync?demo=1`.
  const demo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");
  const { session, loading } = useSession();
  const { isImpersonating } = useImpersonation();
  // The demo asks nothing of the server: no admin check on the visitor's
  // behalf, no catalogue read the RPC would refuse them anyway.
  const access = useIsPlatformAdmin(demo ? null : session);
  const admin = !demo && !isImpersonating && access.data === true;
  const list = useQuery({
    queryKey: ["admin", "workspaces"],
    queryFn: readWorkspaces,
    enabled: admin,
  });
  const catalogue = useAdminPlanCatalogue(admin);
  // The accounts page's read and cache key: the owner column, nothing more.
  const accounts = useQuery({
    queryKey: ["admin", "accounts", "live"],
    queryFn: readAdminAccounts,
    enabled: admin,
  });
  const demoList = useQuery({
    queryKey: ["admin", "demo"],
    queryFn: ({ signal }) => loadAdminDemo(signal),
    enabled: demo,
  });

  const shell = (body: ReactNode, showTabs = true) => (
    <div className="db-page">
      <header className="db-hero">
        <Badge tone="neutral">
          {demo ? `${S.adminEyebrow} · ${S.dashDemoTag}` : S.adminEyebrow}
        </Badge>
        <h1>{S.adminTitle}</h1>
        <p>{demo ? S.adminDemoLead : S.adminLead}</p>
        {showTabs && <AdminTabs />}
      </header>
      {body}
    </div>
  );

  if (demo)
    return shell(
      demoList.isPending ? (
        <Loading S={S} label={S.adminLoading} shape="ops" />
      ) : demoList.isError ? (
        <LoadError
          S={S}
          failure={failureCode("read", demoList.error)}
          onRetry={() => void demoList.refetch()}
        />
      ) : (
        <DemoWorkspaces initial={demoList.data} />
      ),
    );

  // Nothing is said until it is known: a "forbidden" that flips to a table a
  // moment later reads as the page changing its mind about who you are.
  if (loading || (session && access.isPending))
    return shell(<Loading S={S} label={S.pageOpening} shape="ops" />);
  if (access.isError)
    return shell(
      <LoadError
        S={S}
        message={S.serviceUnreachable}
        failure={failureCode("read", access.error)}
        onRetry={() => void access.refetch()}
      />,
    );
  // Signed out, unconfigured, or signed in and not an admin: one sentence.
  if (!session || !admin)
    return shell(
      <Card className="db-error">
        <p role="alert" data-testid="admin-forbidden">
          {S.adminForbidden}
        </p>
      </Card>,
      false,
    );
  if (list.isPending)
    return shell(<Loading S={S} label={S.adminLoading} shape="ops" />);
  if (list.isError)
    return shell(
      <LoadError
        S={S}
        message={adminErrorMessage(list.error, S)}
        failure={failureCode("read", list.error)}
        onRetry={() => void list.refetch()}
      />,
    );
  return shell(
    <LiveWorkspaces
      rows={list.data}
      catalogue={catalogue.data ?? []}
      owners={
        accounts.data &&
        new Map(accounts.data.map((a) => [a.id, a.email] as const))
      }
    />,
  );
}

/** The live table: every lever is an RPC, and after one lands the lists
 *  that show its effect are re-read — this table, and every plan card and
 *  panel, so an admin changing their own workspace's plan sees the rail
 *  change with it. */
export function LiveWorkspaces({
  rows,
  catalogue,
  stacked,
  owners,
}: {
  rows: AdminWorkspace[];
  catalogue: { key: string; title_ar: string; title_en: string }[];
  /** Cards whatever the screen: the account file is a narrow panel. */
  stacked?: boolean;
  owners?: Owners;
}) {
  const queryClient = useQueryClient();
  const act = async (action: AdminAction) => {
    await callServer(action);
    if (action.type === "delete") {
      // Not awaited: the row that called is about to leave the table, and
      // the dialog closes on this promise. The rail's switch reads the same
      // rows; without the second key the deleted workspace stays in it
      // until the tab reloads.
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin"] }),
      queryClient.invalidateQueries({ queryKey: ["plan"] }),
    ]);
  };
  return (
    <Workspaces
      rows={rows}
      catalogue={catalogue}
      act={act}
      stacked={stacked}
      owners={owners}
    />
  );
}

/** The demo table: the fixture's rows in local state, every lever a pure
 *  reduction over them. A refusal is thrown by the reducer in the shape a
 *  PostgREST error has, and the row says it as it would say the server's. */
function DemoWorkspaces({ initial }: { initial: AdminWorkspace[] }) {
  const [rows, setRows] = useState(initial);
  // The reducer reads the rows as they are when a lever is pressed, not as
  // they were when the row's `act` was made: a ref, not a closure. Only
  // `act` changes them, so the ref is always the latest.
  const current = useRef(initial);
  const act = async (action: AdminAction) => {
    const next = reduceAdminDemo(current.current, action, {
      planKeys: DEMO_PLAN_KEYS,
    });
    current.current = next;
    setRows(next);
  };
  return (
    <Workspaces
      rows={rows}
      catalogue={fixtureCatalogue}
      act={act}
      readFootprint={demoFootprint}
      owners={DEMO_OWNERS}
    />
  );
}

/** Who owns each workspace, by `created_by`: an email, or null for an
 *  account with none. Read from `admin_accounts()`, the accounts page's own
 *  read (and its cache), so the list needs no new RPC. */
export type Owners = ReadonlyMap<string, string | null>;

/** The name, the owner's email and the id, folded the way every console
 *  search folds them: many workspaces are called «مساحة العمل الشخصية»,
 *  and the owner is what tells them apart. */
export function matchesWorkspace(
  w: AdminWorkspace,
  owner: string | null | undefined,
  query: string,
): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([w.name, owner, w.id].filter(Boolean).join(" "));
  return words.every((word) => hay.includes(word));
}

/** The section both pages share. On the workspaces page: a searchable list
 *  (a `ui/Table` on a wide screen, cards under 760px) whose «إدارة» opens
 *  the workspace in a side panel, the levers and the delete inside it (owner
 *  console review, 2026-10-13, finding 12). In the account file
 *  (`stacked`): one card per workspace, levers in the card, since a person
 *  holds a few. */
function Workspaces({
  rows: list,
  catalogue,
  act,
  readFootprint,
  stacked,
  owners,
}: {
  rows: AdminWorkspace[];
  catalogue: { key: string; title_ar: string; title_en: string }[];
  act: (action: AdminAction) => Promise<void>;
  readFootprint?: (w: AdminWorkspace) => Promise<Footprint> | Footprint;
  stacked?: boolean;
  owners?: Owners;
}) {
  const S = useStrings();
  const locale = useLocale();
  const narrow = useMediaQuery("(max-width: 760px)");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const options = adminPlanOptions(catalogue, locale);
  const rows = adminRows(list, S, options);
  const keys = options.map((o) => o.key);
  const levers = (w: AdminWorkspace, i: number, layout: "card" | "panel") => (
    <WorkspaceRow
      key={w.id}
      workspace={w}
      row={rows[i]!}
      keys={keys}
      options={options}
      act={act}
      readFootprint={readFootprint && (() => Promise.resolve(readFootprint(w)))}
      layout={layout}
    />
  );
  // Not in the map: the accounts read has not answered (or failed, which
  // the list survives). In it as null: an account with no email.
  const ownerOf = (w: AdminWorkspace) => {
    const email = owners?.get(w.created_by);
    return email === undefined
      ? S.adminWorkspaceOwnerUnknown
      : (email ?? S.adminUsersNoEmail);
  };

  if (rows.length === 0)
    return (
      <section className="db-section" aria-labelledby="admin-table-heading">
        <header>
          <h2 id="admin-table-heading">{S.workspacesTitle}</h2>
        </header>
        <ChartEmpty testId="admin-empty">{S.adminEmpty}</ChartEmpty>
      </section>
    );
  if (stacked)
    return (
      <section className="db-section" aria-labelledby="admin-table-heading">
        <header>
          <h2 id="admin-table-heading">{S.workspacesTitle}</h2>
        </header>
        <div className="db-admin-cards" data-testid="admin-workspaces">
          {list.map((w, i) => levers(w, i, "card"))}
        </div>
      </section>
    );

  // Indexes into `list`, so a row keeps its `adminRows` entry when searched.
  const shown = list
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => matchesWorkspace(w, owners?.get(w.created_by), query));
  // The open workspace is looked up, not kept: once it is deleted it leaves
  // the list, and the panel closes with it.
  const openAt = list.findIndex((w) => w.id === openId);
  const open = openAt >= 0 ? list[openAt]! : null;
  const manage = (w: AdminWorkspace, i: number) => (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => setOpenId(w.id)}
      aria-label={S.adminWorkspaceManage(rows[i]!.name)}
      data-testid={`admin-manage-ws-${w.id}`}
    >
      {S.adminUserManage}
    </Button>
  );

  return (
    <section
      className="db-section admin-console"
      aria-labelledby="admin-table-heading"
    >
      <header>
        <h2 id="admin-table-heading">{S.workspacesTitle}</h2>
      </header>
      <div className="admin-console-bar">
        <Input
          type="search"
          aria-label={S.adminWorkspacesSearch}
          placeholder={S.adminWorkspacesSearch}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="admin-account-muted" aria-live="polite">
        {S.adminWorkspacesCount(shown.length, list.length)}
      </p>
      {shown.length === 0 ? (
        <ChartEmpty testId="admin-workspaces-no-match">
          {S.adminWorkspacesNoMatch}
        </ChartEmpty>
      ) : narrow ? (
        <div className="db-admin-cards" data-testid="admin-workspaces">
          {shown.map(({ w, i }) => (
            <Card
              key={w.id}
              className="db-admin-card"
              data-testid={`admin-row-${w.id}`}
            >
              <h3 className="db-card-title" dir="auto">
                {rows[i]!.name}
              </h3>
              <p className="admin-channel-sub" dir="auto">
                {ownerOf(w)}
              </p>
              <p>
                {rows[i]!.plan} · {rows[i]!.status}
              </p>
              <div className="db-row-actions">{manage(w, i)}</div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="table-wrap db-admin-wrap">
          <Table data-testid="admin-workspaces">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{S.workspaceNameLabel}</TableHeaderCell>
                <TableHeaderCell>{S.adminWorkspaceOwner}</TableHeaderCell>
                <TableHeaderCell>{S.adminPlan}</TableHeaderCell>
                <TableHeaderCell>{S.adminStatus}</TableHeaderCell>
                <TableHeaderCell>{S.adminPeriodEnd}</TableHeaderCell>
                <TableHeaderCell>{S.adminProvider}</TableHeaderCell>
                <TableHeaderCell>{S.adminUsersActions}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map(({ w, i }) => (
                <TableRow key={w.id} data-testid={`admin-row-${w.id}`}>
                  <th scope="row" dir="auto">
                    {rows[i]!.name}
                  </th>
                  <TableCell dir="auto">{ownerOf(w)}</TableCell>
                  <TableCell>{rows[i]!.plan}</TableCell>
                  <TableCell>{rows[i]!.status}</TableCell>
                  <TableCell className="ui-num">{rows[i]!.periodEnd}</TableCell>
                  <TableCell>{rows[i]!.provider}</TableCell>
                  <TableCell>{manage(w, i)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog
        open={open !== null}
        onOpenChange={(isOpen) => !isOpen && setOpenId(null)}
      >
        <DialogContent
          variant="sheet"
          closeLabel={S.adminWorkspacePanelClose}
          className="admin-account-sheet"
          aria-describedby={undefined}
          data-testid="admin-workspace-panel"
        >
          {open && (
            <div className="admin-account">
              <header className="admin-account-head">
                <DialogTitle>
                  <span dir="auto">{rows[openAt]!.name}</span>
                </DialogTitle>
                <small dir="auto">{ownerOf(open)}</small>
              </header>
              {levers(open, openAt, "panel")}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
