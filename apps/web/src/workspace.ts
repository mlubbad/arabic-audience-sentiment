/**
 * Which workspace the dashboard is reading, and what to do when there isn't one.
 *
 * The dashboard used to start from a hard-coded fixture workspace id in every
 * mode. In live mode that would query a workspace that does not exist and
 * render the result as an empty channel — an answer, where the truth is that no
 * question was asked.
 *
 * The decision is a pure function because its interesting parts are all the
 * states that are not "ready": not signed in, signed in with nothing, and
 * signed in with several. Each of those needs a different next step, and each
 * is easy to leave until a real user finds it.
 */
import type { DataMode } from "./data";

export type WorkspaceOption = { id: string; name: string };

export type WorkspaceState =
  /** Fixture mode: one synthetic workspace, no choice to make. */
  | { kind: "fixture"; id: string }
  /** Live data belongs to somebody; there is nothing to show a stranger. */
  | { kind: "needs_auth" }
  /** Signed in, but the account has no workspace yet. */
  | { kind: "no_workspaces" }
  /** More than one, and none chosen yet. Showing the first would be a guess. */
  | { kind: "choose"; options: WorkspaceOption[] }
  | { kind: "ready"; id: string; name: string; options: WorkspaceOption[] };

export function workspaceState(input: {
  mode: DataMode;
  fixtureWorkspace: string;
  signedIn: boolean;
  workspaces?: WorkspaceOption[] | null;
  selectedId: string | null;
}): WorkspaceState {
  const { mode, fixtureWorkspace, signedIn, selectedId } = input;
  const workspaces = input.workspaces ?? [];
  if (mode === "sanitized_fixture")
    return { kind: "fixture", id: fixtureWorkspace };
  if (!signedIn) return { kind: "needs_auth" };
  if (workspaces.length === 0) return { kind: "no_workspaces" };

  const chosen = workspaces.find((w) => w.id === selectedId);
  if (chosen)
    return {
      kind: "ready",
      id: chosen.id,
      name: chosen.name,
      options: workspaces,
    };
  // A stale or forged selection is not silently replaced with another tenant's
  // workspace: it falls back to choosing, so the id on screen is always one the
  // user picked from their own list.
  if (workspaces.length === 1)
    return {
      kind: "ready",
      id: workspaces[0].id,
      name: workspaces[0].name,
      options: workspaces,
    };
  return { kind: "choose", options: workspaces };
}

/** The workspace to query, or null when there is nothing legitimate to query. */
export function readableWorkspace(state: WorkspaceState): string | null {
  if (state.kind === "fixture") return state.id;
  if (state.kind === "ready") return state.id;
  return null;
}
