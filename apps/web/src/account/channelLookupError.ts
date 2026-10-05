/** Why a channel search failed, as the reader sees it.
 *
 * The lookup function answers a refusal with `{ code }`. Four codes have a
 * sentence of their own; every other failure used to read as the same
 * "try again", which left the owner opening DevTools to learn whether the
 * reader token had lapsed, the key was refused or the function was down
 * (2026-10-05). The generic sentence now carries the code, so a screenshot
 * is enough to diagnose it.
 */
import type { Strings } from "../strings";

/** A code is shown only in this shape: the server's own codes
 *  (`source_access_denied:quotaExceeded`), an HTTP status or an error class
 *  name. Anything else — a body that is not ours — is not echoed. */
const SHOWABLE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The code behind a failed `functions.invoke`: the body's `code` when the
 *  function answered, else the HTTP status, else the client's error class
 *  (`FunctionsFetchError` when the function could not be reached). */
export async function lookupCode(error: unknown): Promise<string> {
  const e = error as {
    context?: Response;
    code?: unknown;
    name?: unknown;
  };
  const context = e?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = (await context.json()) as { code?: unknown };
      if (typeof body?.code === "string" && body.code) return body.code;
    } catch {
      // The body had no code; the fallbacks decide.
    }
  }
  if (typeof e?.code === "string" && e.code) return e.code;
  if (typeof context?.status === "number" && context.status > 0)
    return `http_${context.status}`;
  if (typeof e?.name === "string" && e.name && e.name !== "Error")
    return e.name;
  return "";
}

/** The lookup refusal, in the reader's language. */
export function lookupErrorMessage(code: string, S: Strings): string {
  switch (code) {
    case "lookup_not_configured":
      return S.addChannelNotConfigured;
    case "quota_exceeded":
      return S.addChannelQuota;
    case "invalid_query":
      return S.addChannelQueryInvalid;
    case "channel_not_public":
    case "channel_not_found":
      return S.channelNotFoundOnPlatform;
    default:
      return SHOWABLE.test(code)
        ? S.addChannelFailedCode(code)
        : S.addChannelFailed;
  }
}
