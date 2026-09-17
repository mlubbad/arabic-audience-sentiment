/**
 * The demo copy of `/account`'s four reads and its self-service actions
 * (rename, retire, disconnect, connect, create a workspace), replayed over a
 * fixture instead of Postgres. `Account.tsx` wires this in behind `?demo=1`,
 * so the browser suite can drive the signed-in page without a session — the
 * same shape `ops/Sync.tsx` and `admin/AdminPage.tsx` already use for
 * `/sync` and `/admin`.
 *
 * `reduceAccountDemo` is pure and refuses exactly what the live RPCs refuse:
 * `invalid_name` the way `rename_workspace` does, `last_workspace` the way
 * `retire_workspace` does (both in
 * `supabase/migrations/20260917090000_rename_and_retire_a_workspace.sql`),
 * thrown as the same `{ message, code }` shape a PostgREST error carries so
 * the page maps a demo refusal to the identical `S.*` sentence it would show
 * for the real one.
 *
 * The real `retire_workspace` hands a workspace to the platform owner rather
 * than deleting it — this fixture has no platform owner to hand it to, and
 * the reader driving the demo only needs to see the row leave the list, so
 * `retire` here removes the workspace and every row that pointed at it.
 */
import { z } from "zod";
import { UsageSummarySchema, type UsageSummary } from "@sentiment/contracts";
import type { ChannelRow, JobRow } from "../WorkspaceCard";

export const ACCOUNT_DEMO_FIXTURE = "/fixtures/account.json";

export type AccountDemo = {
  workspaces: { id: string; name: string }[];
  clients: { id: string; workspace_id: string }[];
  channels: ChannelRow[];
  jobs: JobRow[];
  usage: Record<string, UsageSummary>;
};

export type AccountDemoAction =
  | { type: "rename"; w: string; name: string }
  | { type: "retire"; w: string }
  | { type: "disconnect"; w: string }
  | { type: "connect"; w: string }
  | { type: "create"; name: string };

const WorkspaceRowSchema = z
  .object({ id: z.string().uuid(), name: z.string() })
  .strict();
const ClientRowSchema = z
  .object({ id: z.string().uuid(), workspace_id: z.string().uuid() })
  .strict();
const ChannelRowSchema = z
  .object({
    workspace_id: z.string().uuid(),
    channel_id: z.string().uuid(),
    status: z.string(),
    external_channel_id: z.string(),
    handle: z.string().nullable(),
    title: z.string().nullable(),
  })
  .strict();
const JobRowSchema = z
  .object({
    workspace_id: z.string().uuid(),
    status: z.string(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();

const AccountDemoSchema = z
  .object({
    workspaces: z.array(WorkspaceRowSchema).min(1),
    clients: z.array(ClientRowSchema),
    channels: z.array(ChannelRowSchema),
    jobs: z.array(JobRowSchema),
    usage: z.record(UsageSummarySchema),
  })
  .strict();

/** Loads the fixture the same way `adminDemo.ts` loads its: fetched, then
 *  parsed against the contract the live reads answer to (`UsageSummarySchema`
 *  for every entry in `usage`) — a fixture that drifts from the schema fails
 *  here, not as a half-rendered card. */
export async function loadAccountDemo(
  signal?: AbortSignal,
): Promise<AccountDemo> {
  const response = await fetch(ACCOUNT_DEMO_FIXTURE, { signal });
  if (!response.ok) throw new Error("fixture_unavailable");
  return AccountDemoSchema.parse(await response.json());
}

/** Thrown in place of a PostgREST error. The page's `S.*` mapping reads
 *  `error.message` as the refusal code, the same as it does for a real RPC
 *  failure. */
function refuse(message: string, code: string): never {
  throw { message, code };
}

/** A workspace id's last UUID group, read as a plain hex integer — `…a1` is
 *  `0xa1` (161), `…000c1` is `0xc1` (193), and so on. 0 for anything that
 *  does not parse as hex (there is no such id in this fixture, but a
 *  malformed one should lose the race for "highest" rather than throw). */
function workspaceSeq(id: string): number {
  const group = id.slice(id.lastIndexOf("-") + 1);
  const n = parseInt(group, 16);
  return Number.isNaN(n) ? 0 : n;
}

/** The next workspace's id: the UUID's last group, one past the highest any
 *  current workspace's id carries — plain hex arithmetic on the group
 *  itself, not a hand-rolled `a1`..`a9`/`b1`..`b9` letter scheme (which ran
 *  out at seq 55, formatting an invalid `g1`). Hex has nowhere to run out to
 *  short of 16^12 workspaces, and the fixture's own `…a1`/`…a2`/`…a3`
 *  continue exactly as `…a4`, `…a5`, … Read from the state rather than its
 *  length, so a create after a retire never reuses an id an earlier create
 *  (or the fixture itself) already claimed. */
function nextWorkspaceId(workspaces: { id: string }[]): string {
  const highest = workspaces.reduce(
    (max, w) => Math.max(max, workspaceSeq(w.id)),
    0,
  );
  const group = (highest + 1).toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${group}`;
}

/**
 * Reduces one action over the demo state. Never mutates `state` or any row
 * in it; a successful call returns a new object.
 */
export function reduceAccountDemo(
  state: AccountDemo,
  action: AccountDemoAction,
): AccountDemo {
  switch (action.type) {
    case "rename": {
      const cleaned = action.name.trim();
      if (cleaned.length < 1 || cleaned.length > 120)
        refuse("invalid_name", "22023");
      return {
        ...state,
        workspaces: state.workspaces.map((w) =>
          w.id === action.w ? { ...w, name: cleaned } : w,
        ),
      };
    }

    case "retire": {
      if (state.workspaces.length <= 1) refuse("last_workspace", "55000");
      const usage = Object.fromEntries(
        Object.entries(state.usage).filter(([id]) => id !== action.w),
      );
      return {
        workspaces: state.workspaces.filter((w) => w.id !== action.w),
        clients: state.clients.filter((c) => c.workspace_id !== action.w),
        channels: state.channels.filter((c) => c.workspace_id !== action.w),
        jobs: state.jobs.filter((j) => j.workspace_id !== action.w),
        usage,
      };
    }

    case "disconnect":
      return {
        ...state,
        channels: state.channels.filter((c) => c.workspace_id !== action.w),
      };

    case "connect":
      // Leaving for Google's consent screen is not something the demo can
      // do; the page shows S.demoExternalNote instead. Nothing changes here
      // but the reference, so a caller can always tell a fresh render from
      // the one before it.
      return { ...state };

    case "create": {
      const workspace = {
        id: nextWorkspaceId(state.workspaces),
        name: action.name,
      };
      return { ...state, workspaces: [...state.workspaces, workspace] };
    }
  }
}
