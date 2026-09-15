import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FixtureSchema } from "@sentiment/contracts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const shared = vi.hoisted(() => ({
  user: "user-b",
  workspaces: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "مساحة ب" }],
  workspacesLoading: false,
  forcedPlace: null as null | {
    kind: "ready";
    id: string;
    name: string;
    options: { id: string; name: string }[];
  },
  /** What React Query would have in cache, addressed exactly as it is. */
  cache: new Map<string, unknown>(),
}));

vi.mock("./session", () => ({
  useSession: () => ({
    session: shared.user ? { user: { id: shared.user } } : null,
    loading: false,
  }),
  useWorkspaces: () => ({
    workspaces: shared.workspaces,
    loading: shared.workspacesLoading,
    failed: false,
  }),
}));
vi.mock("./workspace", async (importOriginal) => {
  const real = await importOriginal<typeof import("./workspace")>();
  return {
    ...real,
    workspaceState: (input: Parameters<typeof real.workspaceState>[0]) =>
      shared.forcedPlace ?? real.workspaceState(input),
  };
});
// The real module, with only the build-time switch forced. `deriveSnapshot`
// in particular stays real: this test is about which cache entry the component
// reads, and a hand-written stand-in for the derivation would let a rendering
// bug pass as an identity guarantee.
vi.mock("./data", async (importOriginal) => {
  const real = await importOriginal<typeof import("./data")>();
  return {
    ...real,
    // `configuredMode` is read inside the real module's own closure, so
    // overriding the export alone would leave `resolveMode` answering
    // "sanitized_fixture" and this whole file testing the demo path.
    configuredMode: "live",
    resolveMode: ({
      signedIn,
      workspace,
    }: {
      signedIn: boolean;
      workspace: string | null;
    }) => (signedIn && workspace ? "live" : "sanitized_fixture"),
    loadSource: vi.fn(),
    submitReview: vi.fn(),
    buildExport: vi.fn(),
  };
});
// React Query, modelled at the only property this test depends on: a query
// reads the entry its key addresses, and nothing else. That is the whole
// mechanism now — identity lives in the key rather than in a callback that
// compares an old key with a new one and can be got wrong by a later edit.
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: unknown[] }) => ({
    data: shared.cache.get(JSON.stringify(options.queryKey)),
    isPending: false,
    isError: false,
    isFetching: true,
    refetch: vi.fn(),
  }),
  useMutation: () => ({
    isPending: false,
    isError: false,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { Dashboard } from "./Dashboard";
import { MemoryRouter } from "react-router";

/** The page reads the address bar now (`?ws=`), so it renders inside a
 *  router. The address is a parameter so a test can open the page by link. */
const render = (at = "/dashboard") =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [at] },
      createElement(Dashboard),
    ),
  );

const fixture = FixtureSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../public/fixtures/dashboard.json", import.meta.url),
      "utf8",
    ),
  ),
);
/** One tenant's *source* — what a read returns, before any filter. */
const sourceFor = (workspace: string, marker: string) => ({
  mode: "live" as const,
  revision: workspace,
  active_analysis_key: fixture.active_analysis_key,
  active_analysis_labels: fixture.active_analysis_labels,
  plan: fixture.plan,
  sync: fixture.sync,
  comments: fixture.comments.map((comment, index) => ({
    ...comment,
    workspace_id: workspace,
    text_raw: index === 0 ? marker : comment.text_raw,
  })),
});
const key = (user: string, workspace: string) =>
  JSON.stringify(["dashboard-source", user, "live", workspace]);

describe("dashboard identity boundary", () => {
  beforeEach(() => {
    shared.user = "user-b";
    shared.workspaces = [{ id: B, name: "مساحة ب" }];
    shared.workspacesLoading = false;
    shared.forcedPlace = null;
    shared.cache.clear();
    // Tenant A's rows are in the cache throughout, addressed to tenant A.
    shared.cache.set(
      key("user-a", A),
      sourceFor(A, "TENANT_A_PRIVATE_COMMENT"),
    );
  });

  it("renders a workspace's own comment when the key is its own", () => {
    // The other three assert an absence, and an absence is worth nothing until
    // something proves the presence was reachable at all. Without this, a
    // component that rendered no comments ever would satisfy every one of them.
    shared.cache.set(key("user-b", B), sourceFor(B, "TENANT_B_OWN_COMMENT"));
    const html = render();
    expect(html).toContain("TENANT_B_OWN_COMMENT");
    expect(html).not.toContain("TENANT_A_PRIVATE_COMMENT");
  });

  it("does not render a previous workspace's comment while the next workspace loads", () => {
    const html = render();
    expect(html).not.toContain("TENANT_A_PRIVATE_COMMENT");
  });

  it("does not render a signed-in workspace's comment after sign-out", () => {
    shared.user = "";
    shared.workspaces = [];
    const html = render();
    expect(html).not.toContain("TENANT_A_PRIVATE_COMMENT");
  });

  it("does not serve one workspace's rows to another of the same user", () => {
    // Same person, two workspaces. The workspace is in the key for this
    // reason: an owner of both must still be shown the one they asked for.
    shared.cache.set(
      key("user-b", A),
      sourceFor(A, "TENANT_A_PRIVATE_COMMENT"),
    );
    const html = render();
    expect(html).not.toContain("TENANT_A_PRIVATE_COMMENT");
  });

  it("does not offer the fixture as a signed-in creator's data while workspaces load", () => {
    shared.workspaces = [];
    shared.workspacesLoading = true;
    const html = render();
    expect(html).toContain("جارٍ تحميل مساحات العمل");
    expect(html).not.toContain("بيانات اصطناعية");
  });

  it("shows the workspace a link names, and asks when the link names a stranger's", () => {
    // Same person, two workspaces, nothing remembered. A link to B is a
    // choice of B: the page opens on it, not on a question.
    shared.workspaces = [
      { id: A, name: "مساحة أ" },
      { id: B, name: "مساحة ب" },
    ];
    shared.cache.set(key("user-b", B), sourceFor(B, "TENANT_B_OWN_COMMENT"));
    const byLink = render(`/dashboard?ws=${B}`);
    expect(byLink).toContain("TENANT_B_OWN_COMMENT");
    expect(byLink).not.toContain('data-testid="ws-choose"');
    // The same link with an id that is not in this account's list: a claim,
    // not a permission. The page asks. It does not fall back to B either —
    // a link that named the wrong place is answered with a question, not
    // with a guess.
    const stranger = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const forged = render(`/dashboard?ws=${stranger}`);
    expect(forged).toContain('data-testid="ws-choose"');
    expect(forged).not.toContain("TENANT_B_OWN_COMMENT");
    expect(forged).not.toContain("TENANT_A_PRIVATE_COMMENT");
  });

  it("does not keep a switch of its own once a creator has chosen", () => {
    // Switching lives in the rail now (RailState.tsx), one control on every
    // screen. A second select with the same name inside the page would be
    // the two-implementations shape this codebase keeps finding.
    shared.forcedPlace = {
      kind: "ready",
      id: B,
      name: "مساحة ب",
      options: [
        { id: A, name: "مساحة أ" },
        { id: B, name: "مساحة ب" },
      ],
    };
    const html = render();
    expect(html).not.toContain('aria-label="تغيير مساحة العمل"');
    expect(html).toContain('data-testid="source-scope">مساحة ب');
    expect(html).not.toContain(`data-testid="source-scope">مساحة العمل ${B}`);
  });
});
