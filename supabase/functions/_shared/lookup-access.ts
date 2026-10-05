/**
 * Who may name a channel for a workspace, and why not.
 *
 * The lookup refused all three failures with one `forbidden`, so a refused
 * session, a failed membership read and a missing role looked the same from
 * the browser and left nothing in the function log (2026-10-05: the owner's
 * search failed with `forbidden` and the cause could not be told apart). Each
 * now has its own code. None says more than the caller already knows: the
 * membership read runs under the caller's own row security, so a workspace
 * that does not exist and one the caller is not in both read as `role`.
 */
export type LookupRefusal =
  "forbidden:session" | "forbidden:membership_read" | "forbidden:role";

export type LookupAccessInput = {
  user: { id: string } | null | undefined;
  userError: unknown;
  memberships: { role: string }[] | null | undefined;
  memberError: unknown;
};

const NAMING_ROLES = new Set(["workspace_owner", "analyst"]);

/** The refusal for this caller, or null when they may name a channel. */
export function lookupRefusal(input: LookupAccessInput): LookupRefusal | null {
  if (input.userError || !input.user) return "forbidden:session";
  if (input.memberError) return "forbidden:membership_read";
  if (!input.memberships?.some((m) => NAMING_ROLES.has(m.role)))
    return "forbidden:role";
  return null;
}

/** What the log may say about the cause: an error's name, code and message,
 *  never the request or its token. */
export function refusalDetail(error: unknown): Record<string, string> {
  if (!error || typeof error !== "object") return {};
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  const out: Record<string, string> = {};
  for (const key of ["name", "code", "message"] as const) {
    const v = e[key];
    if (typeof v === "string" && v) out[key] = v.slice(0, 200);
  }
  return out;
}
