/**
 * The chosen workspace, in the address bar.
 *
 * `workspaceSelection.ts` made the choice survive a navigation; it did not
 * make it shareable. A reader who copied the address of the dashboard they
 * were looking at sent a link to *a* dashboard — the recipient saw whichever
 * workspace their own browser last remembered, or a question. The last open
 * half of the audit's first finding was exactly this: the selection was not
 * in the URL, so a link did not carry which workspace it showed.
 *
 * Now it does, as `?ws=<id>`. The rules, in order:
 *
 * 1. **The address wins.** A page opened with `?ws=` shows that workspace,
 *    whatever the browser remembered. Following a link is a choice, and it
 *    is remembered like one.
 * 2. **A remembered choice is written back.** A page opened without the
 *    parameter, by a reader who has chosen before, shows the remembered
 *    workspace and puts it in the address — so the address is always the
 *    one to copy, not only after a fresh choice.
 * 3. **An id in the address is a claim, not a permission.** Nothing here
 *    checks it. `workspaceState` looks it up in the account's own list and
 *    falls back to asking when it is not there, so a forged or stale link can
 *    cost the reader a question and can never select another tenant's data.
 *
 * All of it is pure. The hook that applies these to the router is a shell,
 * because a hook's effects cannot be run in this test environment and the
 * rules are the part that has to be right.
 */

export const WORKSPACE_PARAM = "ws";

/** The id the address names, or null. Whitespace and an empty value are "none". */
export function workspaceFromSearch(
  search: string | URLSearchParams,
): string | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const value = params.get(WORKSPACE_PARAM)?.trim();
  return value ? value : null;
}

/** The same query string with the workspace set, replaced, or removed. Every
 *  other parameter survives: the operations demo's `?demo=1`, for one. */
export function searchWithWorkspace(
  search: string | URLSearchParams,
  id: string | null,
): URLSearchParams {
  const next = new URLSearchParams(
    typeof search === "string" ? search : search.toString(),
  );
  if (id) next.set(WORKSPACE_PARAM, id);
  else next.delete(WORKSPACE_PARAM);
  return next;
}

/** What to show, and which of the two places needs bringing into step. */
export function reconcileSelection(input: {
  inUrl: string | null;
  stored: string | null;
  /** No account, no memory to write: a visitor's URL is still honoured. */
  signedIn: boolean;
}): {
  selected: string | null;
  /** Write this to the store, because the address said so. */
  remember: string | null;
  /** Write this to the address, because the store said so. */
  writeUrl: string | null;
} {
  const { inUrl, stored, signedIn } = input;
  if (inUrl)
    return {
      selected: inUrl,
      remember: signedIn && inUrl !== stored ? inUrl : null,
      writeUrl: null,
    };
  return { selected: stored, remember: null, writeUrl: stored };
}

/** Only the workspace, from a query string — for a link that should carry the
 *  selection to another page and nothing else from this one. */
export function carriedSearch(search: string): string {
  const id = workspaceFromSearch(search);
  return id ? `?${searchWithWorkspace("", id).toString()}` : "";
}
