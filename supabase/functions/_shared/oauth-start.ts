/**
 * Begins a YouTube connection: PKCE, the state, and the authorization URL.
 *
 * Everything here runs server-side. The browser is handed a URL and never the
 * verifier, because the verifier is presented at the token exchange by us and
 * would be worth stealing on the way through. The state travels through the
 * browser by necessity, so only its hash is stored.
 *
 * The token exchange itself is not here: it needs the Google client secret and
 * a registered redirect URI, neither of which exists yet. What this does is
 * everything up to the redirect, which needs no credentials to be correct.
 *
 * Pure, with injected config, randomness and data layer, so it is testable
 * without a deployed project — the same shape as worker-gateway.ts.
 */
export type Provider = "google" | "facebook" | "instagram";
export const PROVIDERS: readonly Provider[] = [
  "google",
  "facebook",
  "instagram",
];

export interface OauthConfig {
  /** Which consent screen this is bound for. Google when absent. */
  provider?: Provider;
  /** Public client identifier. Not a secret, but still not shipped in VITE_*. */
  client_id: string;
  /** Must match a URI registered with Google exactly, including its path. */
  redirect_uri: string;
  scopes: string[];
}

export interface StartDb {
  /** Calls public.oauth_start as the signed-in user. */
  createState(
    workspace: string,
    client: string,
    stateHash: string,
    verifier: string,
    browserNonceHash: string,
    provider: Provider,
  ): Promise<void>;
}

/** Injected so a test can pin the bytes; production passes crypto.getRandomValues. */
export type RandomBytes = (length: number) => Uint8Array;

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const AUTHORIZE_FACEBOOK = "https://www.facebook.com/v25.0/dialog/oauth";
const AUTHORIZE_INSTAGRAM = "https://www.instagram.com/oauth/authorize";
// Meta's consent screens take the scopes as a comma-separated list and do not
// document PKCE; the state, hashed and bound to the browser nonce, is the
// CSRF protection on these doors.
const FACEBOOK_SCOPE =
  "pages_show_list,pages_read_engagement,pages_read_user_content";
const INSTAGRAM_SCOPE =
  "instagram_business_basic,instagram_business_manage_comments";

/** base64url, unpadded: exactly the unreserved set RFC 7636 asks for. */
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

/** S256, per RFC 7636 4.2. The plain method is never offered. */
export async function codeChallenge(verifier: string): Promise<string> {
  return base64url(await sha256(verifier));
}

export async function sha256Hex(value: string): Promise<string> {
  return [...(await sha256(value))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** https anywhere, or http on the loopback interface and nowhere else. */
export function isSafeRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

export async function beginAuthorization(
  workspace: string,
  client: string,
  config: OauthConfig,
  db: StartDb,
  random: RandomBytes,
): Promise<{ url: string; state: string; nonce: string }> {
  const provider: Provider = config.provider ?? "google";
  if (!config.client_id || !config.redirect_uri)
    throw new Error("oauth_not_configured");
  if (provider === "google" && config.scopes.length === 0)
    throw new Error("oauth_not_configured");
  // Refused rather than coerced: a redirect URI that is not exactly the one
  // registered is a misconfiguration, and http would put the code on the wire.
  //
  // The exception is the loopback interface, which Google documents and which
  // this project needs: a code delivered to 127.0.0.1 never traverses a
  // network, so there is nothing on the wire to intercept. Written as an
  // allowlist of hosts rather than a substring test, because a scheme check
  // that accepted "http://127.0.0.1.evil.test" would be worse than no check.
  if (!isSafeRedirect(config.redirect_uri))
    throw new Error("oauth_not_configured");

  // 32 bytes -> 43 base64url characters, the RFC minimum length, from a source
  // the caller cannot influence.
  const verifier = base64url(random(32));
  const state = base64url(random(32));
  const nonce = base64url(random(32));
  // Stored before the URL is handed out. A callback that arrives for a state
  // we failed to record must not be accepted, so the write happens first.
  await db.createState(
    workspace,
    client,
    await sha256Hex(state),
    verifier,
    await sha256Hex(nonce),
    provider,
  );

  if (provider !== "google") {
    const params = new URLSearchParams({
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
      response_type: "code",
      scope: provider === "facebook" ? FACEBOOK_SCOPE : INSTAGRAM_SCOPE,
      state,
    });
    // Instagram Login is its own door; without this Meta routes the person
    // through Facebook Login, which is the other door.
    if (provider === "instagram") params.set("enable_fb_login", "0");
    return {
      url: `${provider === "facebook" ? AUTHORIZE_FACEBOOK : AUTHORIZE_INSTAGRAM}?${params}`,
      state,
      nonce,
    };
  }

  const params = new URLSearchParams({
    client_id: config.client_id,
    redirect_uri: config.redirect_uri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: "S256",
    // A refresh token is required: collection continues long after the browser
    // session that authorised it has gone.
    access_type: "offline",
    // Without this Google omits the refresh token on a re-authorisation, and
    // the connection would silently become one that cannot be renewed.
    prompt: "consent",
    include_granted_scopes: "false",
  });
  return { url: `${AUTHORIZE}?${params}`, state, nonce };
}
