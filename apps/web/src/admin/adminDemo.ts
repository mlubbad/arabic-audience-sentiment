/**
 * The demo copy of `/admin`'s three server calls: `admin_workspaces()`,
 * `set_workspace_plan()`, `grant_pack()` and `delete_workspace()`, replayed
 * over a fixture instead of Postgres. `AdminPage.tsx` wires this in behind
 * `?demo=1`, so the browser suite can drive the operator's page without a
 * server.
 *
 * `reduceAdminDemo` is pure and refuses exactly what the migrations refuse
 * (`supabase/migrations/20260917100000_delete_workspace.sql` for `delete`,
 * `20260917060000_cancel_drops_to_free.sql`'s rebuilt `set_workspace_plan`
 * for `set_plan`, `20260917020000_usage_grants.sql`'s `grant_units` for
 * `grant_pack`), thrown in the same `{ message, code }` shape a PostgREST
 * error carries so `adminErrorMessage` (`../adminWords.ts`) maps it to the
 * identical sentence the live page would show.
 */
import {
  AdminWorkspacesSchema,
  type AdminWorkspace,
} from "@sentiment/contracts";
import type { PackKind } from "../adminWords";

export const ADMIN_DEMO_FIXTURE = "/fixtures/admin.json";

/** The signed-in demo visitor's own id: `created_by` on rows 1 and 5 of the
 *  fixture — the personal workspace and a client workspace retired to it. */
export const DEMO_OWNER_ID = "00000000-0000-4000-8000-0000000000aa";

/** Demo users matching the fixture workspaces for demo and E2E verification. */
export const DEMO_USERS = [
  {
    id: DEMO_OWNER_ID,
    email: "owner@sentiment.internal",
    created_at: "2026-01-01T00:00:00Z",
    last_sign_in_at: "2026-09-22T10:00:00Z",
    workspace_count: 2,
    owner_count: 2,
  },
  {
    id: "00000000-0000-4000-8000-0000000000c2",
    email: "reem@cooking.example",
    created_at: "2026-03-01T00:00:00Z",
    last_sign_in_at: "2026-09-20T14:30:00Z",
    workspace_count: 1,
    owner_count: 1,
  },
  {
    id: "00000000-0000-4000-8000-0000000000c3",
    email: "nabd@agency.example",
    created_at: "2026-04-15T00:00:00Z",
    last_sign_in_at: "2026-09-21T09:15:00Z",
    workspace_count: 1,
    owner_count: 1,
  },
  {
    id: "00000000-0000-4000-8000-0000000000c4",
    email: "mada@studio.example",
    created_at: "2026-05-10T00:00:00Z",
    last_sign_in_at: "2026-09-18T16:45:00Z",
    workspace_count: 1,
    owner_count: 1,
  },
];

/** Row 1's id: the workspace every other row would bill through, had the
 *  fixture modelled more than one. `delete` refuses to remove it while it is
 *  still a billing root, the same refusal `delete_workspace` raises for the
 *  real one. */
export const DEMO_BILLING_ROOT_ID = "00000000-0000-4000-8000-000000000001";

export type AdminDemoAction =
  | {
      type: "set_plan";
      w: string;
      plan_key: string;
      months: number;
      note: string | null;
      override: boolean;
    }
  | {
      type: "grant_pack";
      w: string;
      kind: PackKind;
      units: number;
      note: string;
    }
  | { type: "delete"; w: string };

/** Loads the fixture the same way `data.ts`/`catalogue.ts` load theirs:
 *  fetched, then parsed against the contract the live RPC answers to — a
 *  fixture that drifts from the schema fails here, not as a half-rendered
 *  table. */
export async function loadAdminDemo(
  signal?: AbortSignal,
): Promise<AdminWorkspace[]> {
  const response = await fetch(ADMIN_DEMO_FIXTURE, { signal });
  if (!response.ok) throw new Error("fixture_unavailable");
  return AdminWorkspacesSchema.parse(await response.json());
}

/** Thrown in place of a PostgREST error. `adminErrorMessage` reads
 *  `error.message` as the refusal code and falls back to `error.code`
 *  (the SQLSTATE) only for a code it does not otherwise recognise. */
function refuse(message: string, code: string): never {
  throw { message, code };
}

function findRow(rows: AdminWorkspace[], id: string): AdminWorkspace {
  const found = rows.find((r) => r.id === id);
  if (!found) refuse("not_found", "P0002");
  return found;
}

function onActivePaddle(row: AdminWorkspace): boolean {
  return (
    row.provider === "paddle" &&
    (row.status === "active" || row.status === "past_due")
  );
}

function addMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Reduces one action over the fixture's rows. Never mutates `rows` or any
 * row in it; a successful call returns a new array. `opts.planKeys` is the
 * set of keys the demo's plan `<select>` offers (`fixtureCatalogue` in
 * `../data.ts`); `opts.now` is injectable so `set_plan`'s `period_end` is
 * deterministic in a test.
 */
export function reduceAdminDemo(
  rows: AdminWorkspace[],
  action: AdminDemoAction,
  opts: { planKeys: ReadonlySet<string>; now?: Date },
): AdminWorkspace[] {
  const now = opts.now ?? new Date();

  switch (action.type) {
    case "set_plan": {
      // Order matches set_workspace_plan: the two argument checks first,
      // then the Paddle guard, which needs the row.
      if (!opts.planKeys.has(action.plan_key)) refuse("unknown_plan", "22023");
      if (action.months < 1 || action.months > 1200)
        refuse("invalid_months", "22023");
      const target = findRow(rows, action.w);
      const onPaddle = onActivePaddle(target);
      if (onPaddle && !action.override)
        refuse("paddle_subscription_active", "55000");
      const periodEnd = addMonths(now, action.months).toISOString();
      return rows.map((r) =>
        r.id !== action.w
          ? r
          : {
              ...r,
              plan_key: action.plan_key,
              status: "active",
              period_end: periodEnd,
              // A Paddle root kept on Paddle when overridden; a row this
              // reducer is the first to activate gets provider "admin".
              provider: onPaddle ? r.provider : "admin",
            },
      );
    }

    case "grant_pack": {
      const target = findRow(rows, action.w);
      if (target.plan_key === null || target.status !== "active")
        refuse("no_active_plan", "42501");
      // The units themselves live in a usage-grants table this fixture does
      // not model; the row itself is unchanged either way.
      return rows.slice();
    }

    case "delete": {
      const target = findRow(rows, action.w);
      // Same order as delete_workspace: last_workspace, then billing_root,
      // then the Paddle guard.
      const ownerRows = rows.filter((r) => r.created_by === DEMO_OWNER_ID);
      if (target.created_by === DEMO_OWNER_ID && ownerRows.length === 1)
        refuse("last_workspace", "55000");
      if (target.id === DEMO_BILLING_ROOT_ID) refuse("billing_root", "55000");
      if (onActivePaddle(target)) refuse("paddle_subscription_active", "55000");
      return rows.filter((r) => r.id !== action.w);
    }
  }
}
