/** The rail's state, rendered.
 *
 * The browser suite runs signed out, so the rail's workspace switch and
 * collection line — both signed-in only — are rendered here with the session,
 * the list and the cache entry forced, inside a router because the switch
 * reads the address.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "./strings/ar";
import { syncHealth, type HealthKey, type SyncState } from "./syncHealth";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const shared = vi.hoisted(() => ({
  user: "owner" as string | null,
  workspaces: [] as { id: string; name: string }[],
  query: { data: undefined as unknown, isPending: false, isError: false },
}));

vi.mock("./session", () => ({
  useSession: () => ({
    session: shared.user ? { user: { id: shared.user } } : null,
    loading: false,
  }),
  useWorkspaces: () => ({
    workspaces: shared.workspaces,
    loading: false,
    failed: false,
  }),
}));
vi.mock("./data", async (importOriginal) => {
  const real = await importOriginal<typeof import("./data")>();
  return {
    ...real,
    configuredMode: "live",
    loadSource: vi.fn(),
    loadOpsSource: vi.fn(),
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => shared.query,
}));

import { CollectionState, WorkspaceSwitch } from "./RailState";
import { resetWorkspaceSelection, selectWorkspace } from "./workspaceSelection";

const render = (el: Parameters<typeof createElement>[0], at = "/dashboard") =>
  renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [at] }, createElement(el)),
  );

const state = (over: Partial<SyncState> = {}): SyncState => ({
  worker: { connected: true, last_heartbeat_at: null, busy: false },
  queued_jobs: 0,
  last_run: null,
  ...over,
});

beforeEach(() => {
  shared.user = "owner";
  shared.workspaces = [
    { id: A, name: "قناة أ" },
    { id: B, name: "قناة ب" },
  ];
  shared.query = { data: undefined, isPending: false, isError: false };
  resetWorkspaceSelection();
});

describe("the rail's workspace", () => {
  it("names the workspace, with no switch, when there is only one", () => {
    shared.workspaces = [{ id: A, name: "قناة أ" }];
    const one = render(WorkspaceSwitch);
    expect(one).not.toContain('role="combobox"');
    expect(one).toContain("قناة أ");
  });

  it("is the only switch: neither page keeps its own", () => {
    // Two selects with one name on one screen is one name too few.
    for (const page of ["dashboard/Dashboard.tsx", "ops/Sync.tsx"]) {
      const src = readFileSync(new URL(`./${page}`, import.meta.url), "utf8");
      expect(src, page).not.toContain("S.changeWorkspace");
    }
  });
});

describe("the rail's collection line", () => {
  it("says what the operations page says, for every state", () => {
    selectWorkspace("owner", A);
    const cases: Array<[Partial<SyncState>, HealthKey]> = [
      [{}, "never_run"],
      [
        { worker: { connected: false, last_heartbeat_at: null, busy: false } },
        "never_run_no_worker",
      ],
      [
        {
          worker: { connected: false, last_heartbeat_at: null, busy: false },
          queued_jobs: 2,
        },
        "stalled",
      ],
    ];
    for (const [over, key] of cases) {
      const sync = state(over);
      shared.query = { data: { sync }, isPending: false, isError: false };
      const html = render(CollectionState);
      // The same function and the same table the operations page reads —
      // one wording, so the two cannot drift.
      expect(syncHealth(sync, new Date()).key).toBe(key);
      expect(html).toContain(`data-key="${key}"`);
      expect(html).toContain(ar.syncMessages[key]);
    }
    // The health panel moved out of Sync.tsx into OperationsPanels.tsx, then
    // out of that file into SyncHealth.tsx; the read is the same line.
    const page = readFileSync(
      new URL("./ops/SyncHealth.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toContain("S.syncMessages[health.key]");
  });

  it("says reading and unavailable rather than guessing, and nothing to a visitor", () => {
    selectWorkspace("owner", A);
    shared.query = { data: undefined, isPending: true, isError: false };
    expect(render(CollectionState)).toContain(ar.railCollectionReading);
    shared.query = { data: undefined, isPending: false, isError: true };
    const failed = render(CollectionState);
    expect(failed).toContain(ar.railCollectionUnavailable);
    expect(failed).not.toContain('data-severity="ok"');
    shared.user = null;
    expect(render(CollectionState)).toBe("");
    expect(render(WorkspaceSwitch)).toBe("");
  });
});
