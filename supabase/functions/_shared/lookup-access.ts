/**
 * Who may name a channel for a workspace, and why not.
 *
 * The lookup refused all three failures with one `forbidden`, so a refused
 * session, a failed membership read and a missing role looked the same from
 * the browser and left nothing in the function log (2026-10-05: the owner's
 * search failed with `forbidden` and the cause could not be told apart). Each
 * now has its own code.
 *
 * The caller is authorized by one database call, `public.my_role(w)`: PostgREST
 * verifies the token and the function answers the caller's own role. The Auth
 * `/user` call it replaces returned an HTML page from inside the function
 * (2026-10-05). A workspace that does not exist and one the caller is not in
 * both answer null and read as `role`, so the refusal says nothing the caller
 * does not already know.
 */
export type LookupRefusal =
  "forbidden:session" | "forbidden:membership_read" | "forbidden:role";

export type LookupAccessInput = {
  role: string | null | undefined;
  roleError: { code?: unknown } | null | undefined;
};

const NAMING_ROLES = new Set(["workspace_owner", "analyst"]);

/** PostgREST refuses a token it cannot verify with a `PGRST3xx` code (the JWT
 *  group). `42501` is the anon role, which may not call `my_role` at all: a
 *  request that carries no user. Both are a refused session; any other error is
 *  a failed role read. */
function isSessionError(code: unknown): boolean {
  return typeof code === "string" && (/^PGRST3/.test(code) || code === "42501");
}

/** The refusal for this caller, or null when they may name a channel. */
export function lookupRefusal(input: LookupAccessInput): LookupRefusal | null {
  if (input.roleError)
    return isSessionError(input.roleError.code)
      ? "forbidden:session"
      : "forbidden:membership_read";
  if (!input.role || !NAMING_ROLES.has(input.role)) return "forbidden:role";
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
