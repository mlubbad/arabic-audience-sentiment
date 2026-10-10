/**
 * The way back to the channels console, and on to the next channel, when the
 * owner enters a channel's workspace from it.
 *
 * Entering a workspace from the console keeps the channels as the console
 * showed them (filtered and ordered) and the console's address, in this
 * tab's sessionStorage. A workspace page that finds its `?ws=` in that list
 * shows «القنوات ‹ name» with the previous and next channel, so the owner
 * walks a hundred channels without going back to the list each time. A new
 * tab, a cleared store or a workspace not in the list shows nothing: the
 * trail is a convenience, and the pages work without it.
 */

const KEY = "admin-trail:v1";

export type TrailItem = { workspace_id: string; name: string };
export type Trail = { back: string; items: TrailItem[] };

export type TrailStep = {
  back: string;
  name: string;
  position: number;
  count: number;
  prev: TrailItem | null;
  next: TrailItem | null;
};

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveTrail(trail: Trail): void {
  try {
    store()?.setItem(KEY, JSON.stringify(trail));
  } catch {
    // A full or blocked store only loses the convenience.
  }
}

export function clearTrail(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The kept trail, or null when there is none or it is not one. */
export function readTrail(): Trail | null {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<Trail>;
    if (
      typeof t.back !== "string" ||
      !t.back.startsWith("/admin/") ||
      !Array.isArray(t.items) ||
      !t.items.every(
        (i) =>
          i && typeof i.workspace_id === "string" && typeof i.name === "string",
      )
    )
      return null;
    return { back: t.back, items: t.items };
  } catch {
    return null;
  }
}

/** Where a workspace stands in the trail, or null when it is not in it. A
 *  workspace with several channels stands at its first. */
export function trailStep(
  trail: Trail | null,
  ws: string | null,
): TrailStep | null {
  if (!trail || !ws) return null;
  const i = trail.items.findIndex((t) => t.workspace_id === ws);
  if (i < 0) return null;
  return {
    back: trail.back,
    name: trail.items[i]!.name,
    position: i + 1,
    count: trail.items.length,
    prev: trail.items[i - 1] ?? null,
    next: trail.items[i + 1] ?? null,
  };
}
