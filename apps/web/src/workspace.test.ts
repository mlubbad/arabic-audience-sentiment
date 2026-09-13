import { describe, expect, it } from "vitest";
import { readableWorkspace, workspaceState } from "./workspace";

const FIXTURE = "00000000-0000-4000-8000-000000000001";
const state = (over = {}) =>
  workspaceState({
    mode: "live",
    fixtureWorkspace: FIXTURE,
    signedIn: true,
    workspaces: [{ id: "ws-1", name: "قناتي" }],
    selectedId: "ws-1",
    ...over,
  });

describe("choosing which workspace the dashboard reads", () => {
  it("never queries the fixture workspace in live mode", () => {
    // The defect this replaces: the dashboard started from a synthetic id in
    // every mode, so live mode would query a workspace that does not exist and
    // draw the empty result as though it were the channel's real answer.
    for (const s of [
      state({ signedIn: false }),
      state({ workspaces: [] }),
      state({
        selectedId: null,
        workspaces: [
          { id: "a", name: "أ" },
          { id: "b", name: "ب" },
        ],
      }),
      state(),
    ])
      expect(readableWorkspace(s)).not.toBe(FIXTURE);
  });

  it("reads nothing at all until there is a workspace to read", () => {
    // Null, not a fallback id. Every "not ready" state must stop the query
    // rather than substitute one.
    expect(readableWorkspace(state({ signedIn: false }))).toBeNull();
    expect(readableWorkspace(state({ workspaces: [] }))).toBeNull();
    expect(
      readableWorkspace(
        state({
          selectedId: null,
          workspaces: [
            { id: "a", name: "أ" },
            { id: "b", name: "ب" },
          ],
        }),
      ),
    ).toBeNull();
    expect(readableWorkspace(state())).toBe("ws-1");
  });

  it("distinguishes not signed in from signed in with nothing", () => {
    // Different problems with different next steps: one is "sign in", the
    // other is "create a workspace". One message for both helps nobody.
    expect(state({ signedIn: false }).kind).toBe("needs_auth");
    expect(state({ workspaces: [] }).kind).toBe("no_workspaces");
  });

  it("does not guess when the account has more than one", () => {
    const many = state({
      selectedId: null,
      workspaces: [
        { id: "a", name: "أ" },
        { id: "b", name: "ب" },
      ],
    });
    expect(many.kind).toBe("choose");
    // With exactly one there is no guess to make, so it is simply used.
    const one = state({ selectedId: null });
    expect(one).toMatchObject({ kind: "ready", id: "ws-1" });
  });

  it("falls back to choosing when the stored selection is not the user's", () => {
    // A stale id from a previous account, or an edited one, must never resolve
    // to a workspace: it is not in the list, so there is nothing to show.
    const forged = state({
      selectedId: "someone-elses-workspace",
      workspaces: [
        { id: "a", name: "أ" },
        { id: "b", name: "ب" },
      ],
    });
    expect(forged.kind).toBe("choose");
    expect(readableWorkspace(forged)).toBeNull();
  });

  it("keeps fixture mode free of the whole question", () => {
    const f = workspaceState({
      mode: "sanitized_fixture",
      fixtureWorkspace: FIXTURE,
      signedIn: false,
      workspaces: [],
      selectedId: null,
    });
    expect(f).toEqual({ kind: "fixture", id: FIXTURE });
    expect(readableWorkspace(f)).toBe(FIXTURE);
  });
});
