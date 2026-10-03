/**
 * What to tell someone when they come back from Google.
 *
 * The callback sends a code, never a sentence: a code is an enum we translate
 * here, while a message could carry a Google error body, and those quote the
 * request back. The translation lives in the app because the app is where the
 * person is, and because an unrecognised code must still say something useful.
 */
import type { StringKey, Strings } from "./strings";
import { OAUTH_BROWSER_NONCE_KEY } from "./connect";
import { supabase } from "./supabase";

export type PendingCompletion =
  { kind: "success"; channelId: string } | { kind: "error"; code: string };

export async function completePendingConnection(
  ticket: string,
): Promise<PendingCompletion> {
  const nonce = sessionStorage.getItem(OAUTH_BROWSER_NONCE_KEY);
  sessionStorage.removeItem(OAUTH_BROWSER_NONCE_KEY);
  if (!nonce || !ticket)
    return { kind: "error", code: "oauth_binding_mismatch" };
  if (!supabase) return { kind: "error", code: "oauth_not_configured" };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { kind: "error", code: "unauthenticated" };
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth-complete`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticket, nonce }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      channel_id?: string;
      code?: string;
    };
    if (!response.ok || !body.channel_id)
      return {
        kind: "error",
        code:
          typeof body.code === "string" && body.code.trim()
            ? body.code
            : "oauth_binding_mismatch",
      };
    return { kind: "success", channelId: body.channel_id };
  } catch {
    return { kind: "error", code: "unreachable" };
  }
}

export type ConnectResult = {
  tone: "success" | "notice" | "error";
  heading: string;
  detail: string;
  /** What the person can actually do next, when there is something. */
  action: "retry" | "console" | null;
};

const FAILURES: Record<
  string,
  { detail: StringKey; action: ConnectResult["action"] }
> = {
  declined: { detail: "crDeclined", action: "retry" },
  youtube_api_not_enabled: { detail: "crApiNotEnabled", action: "console" },
  youtube_scope_missing: { detail: "crScopeMissing", action: "retry" },
  youtube_quota_exceeded: { detail: "crQuotaExceeded", action: null },
  no_channel_on_account: { detail: "crNoChannel", action: "retry" },
  ambiguous_channel: { detail: "crAmbiguousChannel", action: "retry" },
  no_refresh_token: { detail: "crNoRefreshToken", action: "retry" },
  invalid_state: { detail: "crInvalidState", action: "retry" },
  invalid_callback: { detail: "crInvalidCallback", action: "retry" },
  channel_already_connected: { detail: "crAlreadyConnected", action: null },
  oauth_binding_mismatch: { detail: "crBindingMismatch", action: "retry" },
  unauthenticated: { detail: "crUnauthenticated", action: "retry" },
  unreachable: { detail: "crUnreachable", action: "retry" },
};

export function connectResult(
  params: URLSearchParams,
  S: Strings,
  completion: PendingCompletion | null = null,
): ConnectResult {
  if (params.get("connect") === "pending") {
    if (!completion)
      return {
        tone: "notice",
        heading: S.crFinishingHeading,
        detail: S.crFinishingDetail,
        action: null,
      };
    if (completion.kind === "success")
      return {
        tone: "success",
        heading: S.crConnectedHeading,
        detail: S.crConnectedDetailWith(completion.channelId),
        action: null,
      };
    params = new URLSearchParams({ status: "error", code: completion.code });
  }
  if (params.get("status") === "connected") {
    const channel = params.get("channel");
    return {
      tone: "success",
      heading: S.crConnectedHeading,
      detail: channel ? S.crConnectedDetailWith(channel) : S.crConnectedDetail,
      action: null,
    };
  }
  const code = params.get("code") ?? "";
  const known = FAILURES[code];
  if (known)
    return {
      // Declining is a choice, not a failure, and should not be coloured as one.
      tone: code === "declined" ? "notice" : "error",
      heading: code === "declined" ? S.crIncompleteHeading : S.crFailedHeading,
      detail: S[known.detail],
      action: known.action,
    };
  return {
    tone: "error",
    heading: S.crFailedHeading,
    // The code and nothing else: it is diagnosable without being server text.
    detail: S.crUnknownDetail(code || "unknown"),
    action: "retry",
  };
}
