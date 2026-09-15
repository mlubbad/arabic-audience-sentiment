/**
 * Which workspace the reader chose — once, for the whole product.
 *
 * It used to be `useState<string | null>(null)`, written twice: once in
 * `Dashboard.tsx` and once in `Sync.tsx`. Both routes are `lazy()`, so each is
 * torn down on the way out and its state goes with it. The consequence was not
 * subtle and was not hypothetical: choose a workspace on the overview, open
 * operations, and the same question is asked again from nothing. Go back, and
 * it is asked a third time. The answer was never stored anywhere — no context,
 * no route parameter, no storage — so there was nothing for the next screen to
 * read.
 *
 * This is a module-level store rather than a React context on purpose. The
 * selection is one value for the whole session, the module outlives every route
 * that reads it, and a context would have to be threaded through a provider
 * that the component tests do not mount — which would have made "no provider"
 * a silent fallback to local state, i.e. the bug again, wearing the fix's name.
 *
 * Two rules it must not break:
 *
 * 1. **A selection belongs to the account that made it.** It is stored with
 *    the user id and only returned to that user. `useWorkspaces` already
 *    refuses to hand the next user the last user's list; this is the same rule
 *    for the same reason, and it is what makes persistence safe on a shared
 *    machine.
 * 2. **A restored id is a claim, not a permission.** `workspaceState` looks it
 *    up in the account's own list and falls back to asking when it is not
 *    there, so a stale or edited value can only ever cost a question — it can
 *    never select another tenant's workspace. That check is the reason this
 *    file is allowed to remember anything at all.
 */
import { useSyncExternalStore } from "react";

const KEY = "audience.workspace";

type Held = { user: string; id: string } | null;

let held: Held = null;
let loaded = false;
const listeners = new Set<() => void>();

/** Storage can throw outright — Safari's private mode, a blocked origin — and
 *  a remembered convenience is never worth a blank screen. Every access is
 *  guarded, and failure degrades to "ask again", which is today's behaviour. */
function readStore(): Held {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Held & object).user === "string" &&
      typeof (parsed as Held & object).id === "string"
    )
      return parsed as Held;
    return null;
  } catch {
    return null;
  }
}

function writeStore(value: Held) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, JSON.stringify(value));
  } catch {
    /* Remembering is a convenience; failing to remember is not an error. */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The value for this user, or null. Reading for a different user than the one
 *  that made the selection returns null and does not disturb what is held —
 *  signing back in restores it. */
export function selectionFor(userId: string | null): string | null {
  if (!loaded) {
    held = readStore();
    loaded = true;
  }
  if (!userId || !held || held.user !== userId) return null;
  return held.id;
}

export function selectWorkspace(userId: string | null, id: string | null) {
  held = userId && id ? { user: userId, id } : null;
  loaded = true;
  writeStore(held);
  for (const listener of [...listeners]) listener();
}

/** Test seam, and the only way to get back to a clean module. */
export function resetWorkspaceSelection() {
  held = null;
  loaded = false;
  writeStore(null);
  for (const listener of [...listeners]) listener();
}

/**
 * The hook the pages use. It returns the same pair `useState` did, so each call
 * site changes by one line — which is the point: the shape stayed, the storage
 * moved up.
 */
export function useWorkspaceSelection(
  userId: string | null,
): [string | null, (id: string | null) => void] {
  const selected = useSyncExternalStore(
    subscribe,
    () => selectionFor(userId),
    () => selectionFor(userId),
  );
  return [selected, (id: string | null) => selectWorkspace(userId, id)];
}
