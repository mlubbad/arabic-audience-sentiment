/**
 * One workspace, its plan, and the three levers: set a plan for some months,
 * grant a pack of units, delete. Its own component so each row owns its form
 * values, its in-flight state and its feedback — an operator with twenty
 * workspaces must not have to guess which one «تم التنفيذ» was about.
 *
 * The row does not know where a lever lands. `act` is the one call it makes,
 * with the same argument list the RPCs take (`AdminDemoAction` is that list,
 * named for the reducer that replays it); the page passes the server for the
 * live table and `reduceAdminDemo` for the demo, and a refusal from either
 * arrives as the same `{ message, code }` and is said in the same line.
 *
 * Two markups for one row: a `<tbody>` on the wide table, a `Card` with a
 * `<dl>` under 760px — the split `CommentsTable.tsx` and `Compare.tsx` make,
 * because a `<table>` re-flowed by CSS alone cannot become a definition
 * list. The forms are the same elements either way.
 */
import { useState, type FormEvent } from "react";
import type { AdminWorkspace } from "@sentiment/contracts";
import {
  adminErrorMessage,
  adminMonths,
  adminUnits,
  MONTHS_MAX,
  MONTHS_MIN,
  PACK_KINDS,
  type AdminRow,
  type PackKind,
} from "../adminWords";
import { useStrings } from "../strings";
import {
  DeleteWorkspaceDialog,
  type Footprint,
} from "../DeleteWorkspaceDialog";
import type { AdminDemoAction } from "./adminDemo";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { Input } from "../ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import { TableBody, TableCell, TableRow } from "../ui/Table";
import { toast } from "../ui/Toast";

/** The reducer's action is the RPC's argument list, so one type names both
 *  the live call and the demo's. */
export type AdminAction = AdminDemoAction;

export interface WorkspaceRowProps {
  workspace: AdminWorkspace;
  row: AdminRow;
  /** The plan keys the select offers, and their labels in the reader's
   *  language. Two lists because `keys` is consulted on every render. */
  keys: string[];
  options: { key: string; label: string }[];
  /** Performs one lever. Resolves once the change is made (and, on the live
   *  page, once the lists that show it have been re-read); rejects with the
   *  refusal, which `adminErrorMessage` turns into the sentence. */
  act: (action: AdminAction) => Promise<void>;
  /** The delete dialog's count of what goes; defaults to the RPC. */
  readFootprint?: () => Promise<Footprint>;
  /** A `Card` with a `<dl>` instead of a `<tbody>`. */
  stacked?: boolean;
}

export function WorkspaceRow({
  workspace: w,
  row,
  keys,
  options,
  act,
  readFootprint,
  stacked = false,
}: WorkspaceRowProps) {
  const S = useStrings();
  // Field ids from the workspace id: one row, one set — and no `useId` colons,
  // so a browser test can address a field by a plain selector.
  const id = `admin-${w.id}`;
  // The select starts on the plan the row has, if the ladder offers it,
  // otherwise on the first key; a choice made by hand wins over both. Derived,
  // not copied into state, so keys arriving after the row mounts still land.
  const [chosenPlan, setChosenPlan] = useState<string | null>(null);
  const plan =
    chosenPlan ??
    (w.plan_key && keys.includes(w.plan_key) ? w.plan_key : (keys[0] ?? ""));
  const [months, setMonths] = useState("1");
  const [planNote, setPlanNote] = useState("");
  // Off by default: over a root Paddle is billing, set_workspace_plan refuses
  // unless told to override, and even then keeps the Paddle link.
  const [override, setOverride] = useState(false);
  const [kind, setKind] = useState<PackKind>(PACK_KINDS[0]);
  const [units, setUnits] = useState("10000");
  const [packNote, setPackNote] = useState("");
  // One lever at a time per row: both wait while either is in flight.
  const [pending, setPending] = useState(false);
  // What the last pressed lever had to say, and which one it was.
  const [note, setNote] = useState<{
    at: "plan" | "pack";
    text: string;
  } | null>(null);

  async function run(at: "plan" | "pack", action: AdminAction) {
    setPending(true);
    setNote(null);
    try {
      await act(action);
      setNote({ at, text: S.adminDone });
      // The line in the row is the record; the toast is for an operator
      // whose eye has already moved on.
      toast({ title: S.adminDone, description: row.name });
    } catch (error) {
      setNote({ at, text: adminErrorMessage(error, S) });
    } finally {
      setPending(false);
    }
  }

  function submitPlan(e: FormEvent) {
    e.preventDefault();
    const m = adminMonths(months);
    if (pending || !plan || m === null) return;
    void run("plan", {
      type: "set_plan",
      w: w.id,
      plan_key: plan,
      months: m,
      note: planNote.trim() || null,
      override,
    });
  }
  function submitPack(e: FormEvent) {
    e.preventDefault();
    const u = adminUnits(units);
    const n = packNote.trim();
    if (pending || u === null || !n) return;
    // The note is the grant's idempotency key on the server: a second pack
    // with the same note is the same pack, so the form requires one.
    void run("pack", { type: "grant_pack", w: w.id, kind, units: u, note: n });
  }

  const feedback = (at: "plan" | "pack") =>
    note?.at === at ? (
      <p className="db-admin-feedback" role="status">
        {note.text}
      </p>
    ) : pending ? (
      <p className="db-admin-feedback db-admin-feedback--working" role="status">
        {S.working}
      </p>
    ) : null;

  const planForm = (
    <form
      className="db-admin-form"
      data-testid="admin-plan-form"
      onSubmit={submitPlan}
    >
      <div className="ui-field">
        <label htmlFor={`${id}-plan`}>{S.adminPlan}</label>
        <Select
          value={plan}
          disabled={pending || keys.length === 0}
          onValueChange={(value) => setChosenPlan(value)}
        >
          <SelectTrigger id={`${id}-plan`} aria-label={S.adminPlanPicker}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="ui-field">
        <label htmlFor={`${id}-months`}>{S.adminMonths}</label>
        <Input
          id={`${id}-months`}
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
      </div>
      <div className="ui-field">
        <label htmlFor={`${id}-plan-note`}>{S.adminNote}</label>
        <Input
          id={`${id}-plan-note`}
          maxLength={200}
          value={planNote}
          disabled={pending}
          onChange={(e) => setPlanNote(e.target.value)}
        />
      </div>
      <Checkbox
        label={S.adminOverride}
        checked={override}
        disabled={pending}
        onCheckedChange={(checked) => setOverride(checked === true)}
      />
      <Button
        type="submit"
        size="sm"
        disabled={pending || !plan || adminMonths(months) === null}
      >
        {S.adminSetPlan}
      </Button>
      {feedback("plan")}
    </form>
  );

  const packForm = (
    <form
      className="db-admin-form"
      data-testid="admin-pack-form"
      onSubmit={submitPack}
    >
      {/* `ui/Labelled`'s pairing, written out: it takes no `disabled`, and
          this field waits with the others while a lever is in flight. */}
      <div className="ui-field">
        <label htmlFor={`${id}-kind`}>{S.adminKind}</label>
        <Select
          value={kind}
          disabled={pending}
          onValueChange={(value) => setKind(value as PackKind)}
        >
          <SelectTrigger id={`${id}-kind`} aria-label={S.adminKind}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PACK_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {k === "comment_analysis" ? S.budgetAnalysis : S.budgetTopics}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="ui-field">
        <label htmlFor={`${id}-units`}>{S.adminUnits}</label>
        <Input
          id={`${id}-units`}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          required
          value={units}
          disabled={pending}
          onChange={(e) => setUnits(e.target.value)}
        />
      </div>
      <div className="ui-field">
        <label htmlFor={`${id}-pack-note`}>{S.adminNote}</label>
        <Input
          id={`${id}-pack-note`}
          required
          maxLength={200}
          value={packNote}
          disabled={pending}
          onChange={(e) => setPackNote(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={pending || adminUnits(units) === null || !packNote.trim()}
      >
        {S.adminGrantPack}
      </Button>
      {feedback("pack")}
    </form>
  );

  const remove = (
    <DeleteWorkspaceDialog
      workspace={{ id: w.id, name: row.name }}
      onConfirm={() => act({ type: "delete", w: w.id })}
      readFootprint={readFootprint}
    />
  );

  if (stacked)
    return (
      <Card className="db-admin-card" data-testid={`admin-row-${w.id}`}>
        <h3 className="db-card-title">{row.name}</h3>
        <dl className="db-admin-dl">
          <div>
            <dt>{S.adminPlan}</dt>
            <dd>{row.plan}</dd>
          </div>
          <div>
            <dt>{S.adminStatus}</dt>
            <dd>{row.status}</dd>
          </div>
          <div>
            <dt>{S.adminPeriodEnd}</dt>
            <dd>{row.periodEnd}</dd>
          </div>
          <div>
            <dt>{S.adminProvider}</dt>
            <dd>{row.provider}</dd>
          </div>
        </dl>
        <div className="db-admin-levers">
          <div
            role="group"
            className="db-admin-lever"
            aria-label={S.adminSetPlan}
          >
            {planForm}
          </div>
          <div
            role="group"
            className="db-admin-lever"
            aria-label={S.adminGrantPack}
          >
            {packForm}
          </div>
        </div>
        <div className="db-row-actions">{remove}</div>
      </Card>
    );

  // One `<tbody>` per workspace, two rows in it: the values and the delete
  // on the first, the two forms side by side across the second. Eight
  // columns with a stacked form in two of them ran past the content column
  // at 1280 and hid the pack form and the delete behind a sideways scroll.
  return (
    <TableBody data-testid={`admin-row-${w.id}`}>
      <TableRow>
        <th scope="row">{row.name}</th>
        <TableCell>{row.plan}</TableCell>
        <TableCell>{row.status}</TableCell>
        <TableCell className="ui-num">{row.periodEnd}</TableCell>
        <TableCell>{row.provider}</TableCell>
        <TableCell className="db-admin-delete">{remove}</TableCell>
      </TableRow>
      <TableRow className="db-admin-levers-row">
        <TableCell colSpan={6}>
          <div className="db-admin-levers">
            <div
              role="group"
              className="db-admin-lever"
              aria-label={S.adminSetPlan}
            >
              {planForm}
            </div>
            <div
              role="group"
              className="db-admin-lever"
              aria-label={S.adminGrantPack}
            >
              {packForm}
            </div>
          </div>
        </TableCell>
      </TableRow>
    </TableBody>
  );
}
