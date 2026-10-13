/**
 * Starting a channel connection from the browser.
 *
 * The browser's whole part is: ask our function for a URL, and go there. It
 * never sees the verifier, never chooses the redirect, and never learns the
 * client secret — those live on the server, which is the point of doing the
 * exchange there.
 *
 * Split out as a plain function so the states that are not "it worked" can be
 * tested: no session, a workspace the user does not belong to, a project with
 * OAuth unconfigured, and a network that is simply down.
 */
import { supabase } from "./supabase";
import type { StringKey, Strings } from "./strings";

/** A code, never a message: the sentence is chosen where it is shown, in the
 *  reader's language, and a server's own text — which can quote a URL, and a
 *  URL can carry a key — never reaches the screen. */
export type ConnectOutcome =
  { kind: "redirect"; url: string } | { kind: "error"; code: string };

/** Which consent screen to start: Google for YouTube, Meta for the other two. */
export type ConnectProvider = "google" | "facebook" | "instagram";

export const OAUTH_BROWSER_NONCE_KEY = "oauth_browser_nonce";

const MESSAGES: Record<string, StringKey> = {
  unauthenticated: "connectUnauthenticated",
  forbidden: "connectForbidden",
  invalid_client: "connectInvalidClient",
  oauth_not_configured: "connectNotConfigured",
  invalid_request: "connectInvalidRequest",
  unreachable: "serviceUnreachable",
};

/** The sentence for an outcome's code. Unknown codes are shown as codes. */
export function connectErrorMessage(code: string, S: Strings): string {
  const key = MESSAGES[code];
  return key ? S[key] : S.connectUnknownError(code);
}

export async function beginConnect(
  workspaceId: string,
  clientId: string,
  provider: ConnectProvider = "google",
): Promise<ConnectOutcome> {
  if (!supabase) return { kind: "error", code: "oauth_not_configured" };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { kind: "error", code: "unauthenticated" };

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth-start`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          client_id: clientId,
          provider,
        }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      url?: string;
      nonce?: string;
      code?: string;
    };
    if (!response.ok || !body.url || !body.nonce)
      return {
        kind: "error",
        // A code we do not recognise is passed on as a code, never as server text.
        code:
          typeof body.code === "string" && body.code.trim()
            ? body.code
            : String(response.status),
      };
    sessionStorage.setItem(OAUTH_BROWSER_NONCE_KEY, body.nonce);
    return { kind: "redirect", url: body.url };
  } catch {
    return { kind: "error", code: "unreachable" };
  }
}
