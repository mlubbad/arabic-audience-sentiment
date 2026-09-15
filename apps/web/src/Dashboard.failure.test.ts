import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FixtureSchema } from "@sentiment/contracts";

/**
 * What the page does when the read arrives and the derivation cannot use it.
 *
 * The dashboard fetches a workspace's rows once and computes every filtered
 * view from them in the browser. That moved the filtering out of the query
 * function and into a `useMemo` — and a `useMemo` that throws is not an error
 * state, it is an unmounted tree: there is no error boundary above this
 * component, so the reader would get a blank page instead of a notice with a
 * way out of it.
 *
 * Unreachable from the form, which only ever produces filters the schema
 * accepts. Tested anyway, because "cannot happen" is the reason the catch
 * would be deleted by someone tidying up, and the failure it prevents is the
 * whole screen.
 */
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const shared = vi.hoisted(() => ({ source: null as unknown }));

vi.mock("./session", () => ({
  useSession: () => ({ session: { user: { id: "user-b" } }, loading: false }),
  useWorkspaces: () => ({
    workspaces: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "ب" }],
    loading: false,
    failed: false,
  }),
}));
vi.mock("./data", async (importOriginal) => {
  const real = await importOriginal<typeof import("./data")>();
  return {
    ...real,
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
    deriveSnapshot: () => {
      throw new Error("derivation_failed");
    },
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: shared.source,
    isPending: false,
    isError: false,
    isFetching: false,
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

const fixture = FixtureSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../public/fixtures/dashboard.json", import.meta.url),
      "utf8",
    ),
  ),
);

describe("a read that cannot be turned into a screen", () => {
  it("says so, instead of taking the page down", () => {
    shared.source = {
      ...fixture,
      mode: "live",
      comments: fixture.comments.map((c) => ({ ...c, workspace_id: B })),
    };
    // Rendering at all is half the assertion: an uncaught throw here fails the
    // test by propagating, which is precisely the production symptom.
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).toContain("إعادة المحاولة");
    // And it must say which half failed. A read that arrived and a view that
    // could not be built from it are different problems with different
    // answers, and telling the reader to try again is only right for one of
    // them — retrying a derivation that throws will throw again.
    expect(html).toContain("وصلت بياناتك");
    expect(html).toContain('data-testid="failure-code"');
    expect(html).toContain("view:");
  });
});
