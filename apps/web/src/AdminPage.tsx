/**
 * The operator's own screen: every workspace, the plan it is on, and the two
 * hand levers the handoff describes — set a plan for some months, grant a
 * pack of units.
 *
 * The door is `is_platform_admin()`, read through the same hook the rail's
 * link reads, so a reader who is not an admin sees one sentence and no
 * table. The table is `admin_workspaces()`, which refuses a non-admin on the
 * server as well: hiding the page is a courtesy, the database is the gate.
 *
 * Each row carries its own two forms and its own feedback, in the row that
 * caused it: an operator with twenty workspaces must not have to guess which
 * one "تم التنفيذ" was about. After either lever succeeds the list is
 * re-read, and so is every plan card and panel — an admin changing their own
 * workspace's plan sees it change in the rail beside this page.
 *
 * `AdminPage.tsx`, not `Admin.tsx`: `adminWords.ts` and `adminAccess.ts` sit
 * beside it, and on a case-insensitive filesystem a bare `./Admin` would be
 * one import away from resolving to the wrong file.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminWorkspacesSchema,
  type AdminWorkspace,
} from "@sentiment/contracts";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { useIsPlatformAdmin } from "./adminAccess";
import { usePlanCatalogue } from "./planCatalogue";
import {
  adminErrorMessage,
  adminMonths,
  adminPlanKeys,
  adminRows,
  adminUnits,
  MONTHS_MAX,
  MONTHS_MIN,
  PACK_KINDS,
  type AdminRow,
  type PackKind,
} from "./adminWords";
import { useStrings } from "./strings";
import "./report.css";

async function readWorkspaces() {
  const { data, error } = await supabase!.rpc("admin_workspaces");
  // Thrown as it came: the sentence is chosen where it is shown, from the
  // code alone — never from the text, which can carry the request URL.
  if (error) throw error;
  return AdminWorkspacesSchema.parse(data);
}

export function AdminPage() {
  const S = useStrings();
  const { session, loading } = useSession();
  const access = useIsPlatformAdmin(session);
  const admin = access.data === true;
  const list = useQuery({
    queryKey: ["admin", "workspaces"],
    queryFn: readWorkspaces,
    enabled: admin,
  });
  const catalogue = usePlanCatalogue(admin);

  const shell = (body: ReactNode) => (
    <div className="rp-page admin-page">
      <header className="rp-hero">
        <p className="rp-eyebrow">{S.adminEyebrow}</p>
        <h1>{S.adminTitle}</h1>
        <p>{S.adminLead}</p>
      </header>
      {body}
    </div>
  );

  // Nothing is said until it is known: a "forbidden" that flips to a table a
  // moment later reads as the page changing its mind about who you are.
  if (loading || (session && access.isPending))
    return shell(
      <p className="app-state" role="status">
        {S.pageOpening}
      </p>,
    );
  if (access.isError)
    return shell(
      <p className="rp-missing" role="alert">
        {S.serviceUnreachable}
      </p>,
    );
  // Signed out, unconfigured, or signed in and not an admin: one sentence.
  if (!session || !admin)
    return shell(
      <p className="rp-missing" role="alert" data-testid="admin-forbidden">
        {S.adminForbidden}
      </p>,
    );
  if (list.isPending)
    return shell(
      <p className="app-state" role="status">
        {S.adminLoading}
      </p>,
    );
  if (list.isError)
    return shell(
      <p className="rp-missing" role="alert">
        {adminErrorMessage(list.error, S)}
      </p>,
    );

  const rows = adminRows(list.data, S);
  const keys = adminPlanKeys(catalogue.data ?? []);
  return shell(
    <section className="rp-section" aria-labelledby="admin-table-heading">
      <header>
        <h2 id="admin-table-heading">{S.workspacesTitle}</h2>
      </header>
      {rows.length === 0 ? (
        <p className="rp-missing">{S.adminEmpty}</p>
      ) : (
        <div className="table-wrap">
          <table data-testid="admin-workspaces">
            <thead>
              <tr>
                <th scope="col">{S.workspaceNameLabel}</th>
                <th scope="col">{S.adminPlan}</th>
                <th scope="col">{S.adminStatus}</th>
                <th scope="col">{S.adminPeriodEnd}</th>
                <th scope="col">{S.adminProvider}</th>
                <th scope="col">{S.adminSetPlan}</th>
                <th scope="col">{S.adminGrantPack}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((w, i) => (
                <WorkspaceRow
                  key={w.id}
                  workspace={w}
                  row={rows[i]}
                  keys={keys}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>,
  );
}

/** One workspace, its plan, and the two levers. Its own component so each
 *  row owns its form values, its in-flight state and its feedback. */
function WorkspaceRow({
  workspace: w,
  row,
  keys,
}: {
  workspace: AdminWorkspace;
  row: AdminRow;
  keys: string[];
}) {
  const S = useStrings();
  const queryClient = useQueryClient();
  // The select starts on the plan the row has, if the ladder offers it,
  // otherwise on the first key; a choice made by hand wins over both. Derived,
  // not copied into state, so keys arriving after the row mounts still land.
  const [chosenPlan, setChosenPlan] = useState<string | null>(null);
  const plan =
    chosenPlan ??
    (w.plan_key && keys.includes(w.plan_key) ? w.plan_key : (keys[0] ?? ""));
  const [months, setMonths] = useState("1");
  const [planNote, setPlanNote] = useState("");
  const [kind, setKind] = useState<PackKind>(PACK_KINDS[0]);
  const [units, setUnits] = useState("10000");
  const [packNote, setPackNote] = useState("");
  // What the last pressed lever had to say, and which one it was.
  const [note, setNote] = useState<{
    at: "plan" | "pack";
    text: string;
  } | null>(null);

  // The list this row came from, and every plan card and panel: an admin
  // changing their own workspace's plan sees the rail change with it.
  const settled = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin"] }),
      queryClient.invalidateQueries({ queryKey: ["plan"] }),
    ]);
  const setPlanCall = useMutation({
    mutationFn: async (input: {
      plan: string;
      months: number;
      note: string;
    }) => {
      const { error } = await supabase!.rpc("set_workspace_plan", {
        w: w.id,
        plan: input.plan,
        months: input.months,
        note: input.note || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await settled();
      setNote({ at: "plan", text: S.adminDone });
    },
    onError: (error) =>
      setNote({ at: "plan", text: adminErrorMessage(error, S) }),
  });
  const grantCall = useMutation({
    mutationFn: async (input: {
      kind: PackKind;
      units: number;
      note: string;
    }) => {
      // The note is the grant's idempotency key on the server: a second pack
      // with the same note is the same pack, so the form requires one.
      const { error } = await supabase!.rpc("grant_pack", {
        w: w.id,
        kind: input.kind,
        units: input.units,
        note: input.note,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await settled();
      setNote({ at: "pack", text: S.adminDone });
    },
    onError: (error) =>
      setNote({ at: "pack", text: adminErrorMessage(error, S) }),
  });
  // One lever at a time per row: both wait while either is in flight.
  const pending = setPlanCall.isPending || grantCall.isPending;

  function submitPlan(e: FormEvent) {
    e.preventDefault();
    const m = adminMonths(months);
    if (pending || !plan || m === null) return;
    setNote(null);
    setPlanCall.mutate({ plan, months: m, note: planNote.trim() });
  }
  function submitPack(e: FormEvent) {
    e.preventDefault();
    const u = adminUnits(units);
    const n = packNote.trim();
    if (pending || u === null || !n) return;
    setNote(null);
    grantCall.mutate({ kind, units: u, note: n });
  }
  const feedback = (at: "plan" | "pack") =>
    note?.at === at ? (
      <p className="account-feedback notice" role="status">
        {note.text}
      </p>
    ) : pending ? (
      <p className="account-feedback" role="status">
        {S.working}
      </p>
    ) : null;

  return (
    <tr data-workspace={w.id}>
      <th scope="row">{row.name}</th>
      <td>{row.plan}</td>
      <td>{row.status}</td>
      <td>{row.periodEnd}</td>
      <td>{row.provider}</td>
      <td>
        <form className="admin-form" onSubmit={submitPlan}>
          <label>
            {S.adminPlan}
            <select
              value={plan}
              disabled={pending || keys.length === 0}
              onChange={(e) => setChosenPlan(e.target.value)}
            >
              {keys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            {S.adminMonths}
            <input
              type="number"
              inputMode="numeric"
              min={MONTHS_MIN}
              max={MONTHS_MAX}
              step={1}
              required
              value={months}
              disabled={pending}
              onChange={(e) => setMonths(e.target.value)}
            />
          </label>
          <label>
            {S.adminNote}
            <input
              maxLength={200}
              value={planNote}
              disabled={pending}
              onChange={(e) => setPlanNote(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={pending || !plan || adminMonths(months) === null}
          >
            {S.adminSetPlan}
          </button>
          {feedback("plan")}
        </form>
      </td>
      <td>
        <form className="admin-form" onSubmit={submitPack}>
          <label>
            {S.adminKind}
            <select
              value={kind}
              disabled={pending}
              onChange={(e) => setKind(e.target.value as PackKind)}
            >
              {PACK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === "comment_analysis" ? S.budgetAnalysis : S.budgetTopics}
                </option>
              ))}
            </select>
          </label>
          <label>
            {S.adminUnits}
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              required
              value={units}
              disabled={pending}
              onChange={(e) => setUnits(e.target.value)}
            />
          </label>
          <label>
            {S.adminNote}
            <input
              required
              maxLength={200}
              value={packNote}
              disabled={pending}
              onChange={(e) => setPackNote(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={pending || adminUnits(units) === null || !packNote.trim()}
          >
            {S.adminGrantPack}
          </button>
          {feedback("pack")}
        </form>
      </td>
    </tr>
  );
}
