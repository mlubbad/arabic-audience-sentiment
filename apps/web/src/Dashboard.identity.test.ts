import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FixtureSchema, snapshot } from "@sentiment/contracts";

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
  previous: null as unknown,
  previousKey: [] as unknown[],
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
vi.mock("./data", () => ({
  configuredMode: "live",
  fixtureWorkspace: "00000000-0000-4000-8000-000000000001",
  resolveMode: ({
    signedIn,
    workspace,
  }: {
    signedIn: boolean;
    workspace: string | null;
  }) => (signedIn && workspace ? "live" : "sanitized_fixture"),
  reviewsArePersisted: (mode: string) => mode === "live",
  loadSnapshot: vi.fn(),
  submitReview: vi.fn(),
  buildExport: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: {
    placeholderData: (
      previous: unknown,
      previousQuery: { queryKey: unknown[] },
    ) => unknown;
  }) => ({
    data: options.placeholderData(shared.previous, {
      queryKey: shared.previousKey,
    }),
    isPending: false,
    isError: false,
    isFetching: true,
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

const fixture = FixtureSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../public/fixtures/dashboard.json", import.meta.url),
      "utf8",
    ),
  ),
);
const commentsA = fixture.comments.map((comment, index) => ({
  ...comment,
  workspace_id: A,
  text_raw: index === 0 ? "TENANT_A_PRIVATE_COMMENT" : comment.text_raw,
}));
const base = snapshot(
  commentsA,
  { workspace_id: A },
  fixture.active_analysis_key,
);
const previousData = {
  ...base,
  comparison: base.videos,
  comparison_truncated: false,
  mode: "live",
  revision: "a",
  plan: fixture.plan,
  sync: fixture.sync,
  cursor_reset: false,
};

describe("dashboard identity boundary", () => {
  beforeEach(() => {
    shared.user = "user-b";
    shared.workspaces = [{ id: B, name: "مساحة ب" }];
    shared.workspacesLoading = false;
    shared.forcedPlace = null;
    shared.previous = previousData;
    shared.previousKey = ["dashboard", "live", { workspace_id: A }];
  });

  it("does not render a previous workspace's comment while the next workspace loads", () => {
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).not.toContain("TENANT_A_PRIVATE_COMMENT");
  });

  it("does not render a signed-in workspace's comment after sign-out", () => {
    shared.user = "";
    shared.workspaces = [];
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).not.toContain("TENANT_A_PRIVATE_COMMENT");
  });

  it("does not offer the fixture as a signed-in creator's data while workspaces load", () => {
    shared.previous = null;
    shared.workspaces = [];
    shared.workspacesLoading = true;
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).toContain("جارٍ تحميل مساحات العمل");
    expect(html).not.toContain("بيانات اصطناعية");
  });

  it("keeps workspace switching available after a creator chooses one", () => {
    shared.previous = null;
    shared.forcedPlace = {
      kind: "ready",
      id: B,
      name: "مساحة ب",
      options: [
        { id: A, name: "مساحة أ" },
        { id: B, name: "مساحة ب" },
      ],
    };
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).toContain('aria-label="تغيير مساحة العمل"');
    expect(html).toContain("مساحة أ");
    expect(html).toContain("مساحة ب");
    expect(html).toContain('data-testid="source-scope">مساحة ب');
    expect(html).not.toContain(`data-testid="source-scope">مساحة العمل ${B}`);
  });
});
