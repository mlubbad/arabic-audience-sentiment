/**
 * The other half of the connection: exchange the code, find out whose channel
 * it is, seal the tokens, attach.
 *
 * Three things here are load bearing.
 *
 * The channel identity comes from `channels.list(mine=true)` run with the new
 * token — never from anything the browser sent. A callback is reachable by
 * anyone who can guess a URL, so every value it carries is a claim, not a fact.
 *
 * The verifier comes from the state row, not the request. PKCE is worth nothing
 * if the caller supplies both halves.
 *
 * Tokens are sealed before they reach the database, so a database read is not a
 * set of working Google credentials.
 *
 * Pure, with injected transport and data layer, so the whole flow is testable
 * without Google and without a deployed project.
 */
export interface CallbackConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  token_uri: string;
  /** Identifies which key sealed a row, so a rotation can find what to re-seal. */
  key_version: string;
}

export interface CallbackDb {
  /** Single use. Returns the binding the state was created with, or throws. */
  consumeState(stateHash: string): Promise<{
    user_id: string;
    workspace_id: string;
    client_id: string;
    code_verifier: string;
  }>;
  attachChannel(input: {
    userId: string;
    workspaceId: string;
    clientId: string;
    externalChannel: string;
    /** The channel's `@handle` and title as Google reports them, or null for
     *  each one Google leaves out. Names, not identity: the id is identity. */
    handle: string | null;
    title: string | null;
    sealedTokens: Uint8Array;
    keyVersion: string;
    scopes: string[];
  }): Promise<string>;
}

/** Injected so tests need no network, and so nothing here can reach the internet by accident. */
export type Http = (url: string, init: RequestInit) => Promise<Response>;

// `snippet` for the name. The id alone was all the product needed to collect,
// and all it showed: the account page printed `UC…` where a channel name
// should have been, because nothing had ever asked Google for one.
const CHANNELS_URL =
  "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true";

export class ConnectError extends Error {
  constructor(readonly code: string) {
    // The code only. A Google error body can quote the client secret back, and
    // a redirect URI mismatch message carries the whole configuration.
    super(code);
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * AES-GCM, with the nonce carried in front of the ciphertext.
 *
 * A fresh nonce per seal is not optional: GCM reusing one with the same key
 * leaks the keystream, and the tokens for two channels would unwrap each other.
 */
export async function sealTokens(
  key: CryptoKey,
  tokens: unknown,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify(tokens));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, body),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return out;
}

export async function openTokens(
  key: CryptoKey,
  sealed: Uint8Array,
): Promise<unknown> {
  const iv = sealed.slice(0, 12);
  const body = sealed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body);
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function importSealingKey(base64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new ConnectError("invalid_encryption_key");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function exchangeCode(
  code: string,
  verifier: string,
  config: CallbackConfig,
  http: Http,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}> {
  const response = await http(config.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.client_id,
      client_secret: config.client_secret,
      redirect_uri: config.redirect_uri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }).toString(),
  });
  if (!response.ok) throw new ConnectError("token_exchange_failed");
  const body = (await response.json()) as Record<string, unknown>;
  const access = body.access_token;
  const refresh = body.refresh_token;
  if (typeof access !== "string" || !access)
    throw new ConnectError("token_exchange_failed");
  // Collection continues long after the browser session that authorised it. A
  // grant with no refresh token cannot be renewed, and storing it would produce
  // a connection that silently dies in an hour.
  if (typeof refresh !== "string" || !refresh)
    throw new ConnectError("no_refresh_token");
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: typeof body.expires_in === "number" ? body.expires_in : 3600,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

/** Google's machine-readable reason for a refusal, or "" when it gave none. */
async function refusalReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { status?: string; errors?: { reason?: string }[] };
    };
    return body.error?.errors?.[0]?.reason ?? body.error?.status ?? "";
  } catch {
    return "";
  }
}

export type OwnChannel = {
  id: string;
  handle: string | null;
  title: string | null;
};

/** Whose channel this is, according to Google rather than according to the caller. */
export async function fetchOwnChannel(
  accessToken: string,
  http: Http,
): Promise<OwnChannel> {
  const response = await http(CHANNELS_URL, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    // Google's own name for the refusal, which is an enum rather than prose:
    // it carries no request detail and no credential, and it is the difference
    // between "something failed" and "the YouTube Data API is switched off in
    // your Google Cloud project". Anything unrecognised stays generic.
    const reason = await refusalReason(response);
    // Status and reason are enums, never the body: enough to name the refusal
    // in the function log without echoing the request or the credential.
    console.error("channels.list refused", response.status, reason || "-");
    if (reason === "accessNotConfigured" || reason === "SERVICE_DISABLED")
      throw new ConnectError("youtube_api_not_enabled");
    if (reason === "quotaExceeded")
      throw new ConnectError("youtube_quota_exceeded");
    if (reason === "forbidden" || reason === "insufficientPermissions")
      throw new ConnectError("youtube_scope_missing");
    throw new ConnectError("channel_lookup_failed");
  }
  const body = (await response.json()) as {
    items?: {
      id?: unknown;
      snippet?: { title?: unknown; customUrl?: unknown };
    }[];
  };
  const items = body.items ?? [];
  // No channel is a real answer: a Google account without a YouTube channel
  // authorises fine and owns nothing. Inventing one would attach the wrong id.
  if (items.length === 0) throw new ConnectError("no_channel_on_account");
  // More than one means the consent picked an account we cannot disambiguate
  // server-side; guessing would connect the wrong channel.
  if (items.length > 1) throw new ConnectError("ambiguous_channel");
  const id = items[0]?.id;
  if (typeof id !== "string" || !id)
    throw new ConnectError("channel_lookup_failed");
  // The name is a courtesy and the id is the contract: a snippet Google did
  // not send, or sent malformed, costs the reader a label, not the connection.
  const snippet = items[0]?.snippet;
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  return {
    id,
    handle: text(snippet?.customUrl, 100),
    title: text(snippet?.title, 200),
  };
}

export async function handleCallback(input: {
  /** Raw query values as the browser presented them. Every one is a claim. */
  code: string | null;
  state: string | null;
  error: string | null;
  config: CallbackConfig;
  db: CallbackDb;
  http: Http;
  key: CryptoKey;
}): Promise<{ channelId: string; workspaceId: string }> {
  const { code, state, error, config, db, http, key } = input;
  // The user declining is an outcome, not a failure to hide behind a generic code.
  if (error)
    throw new ConnectError(
      error === "access_denied" ? "declined" : "authorization_failed",
    );
  if (!code || !state) throw new ConnectError("invalid_callback");

  // Burns the state. A failed exchange after this point means starting again,
  // which is the correct trade: a state surviving a failure is a replayable code.
  const binding = await db.consumeState(await sha256Hex(state));

  const tokens = await exchangeCode(code, binding.code_verifier, config, http);
  const channel = await fetchOwnChannel(tokens.access_token, http);

  const channelId = await db.attachChannel({
    userId: binding.user_id,
    workspaceId: binding.workspace_id,
    clientId: binding.client_id,
    externalChannel: channel.id,
    handle: channel.handle,
    title: channel.title,
    sealedTokens: await sealTokens(key, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      // Absolute, not a duration: a stored "3600" tells a later reader nothing
      // about whether the token is still valid.
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    }),
    keyVersion: config.key_version,
    scopes: tokens.scope ? tokens.scope.split(" ") : [],
  });
  return { channelId, workspaceId: binding.workspace_id };
}

/**
 * Renews an access token from the stored refresh token.
 *
 * Two things about Google's response are easy to get wrong and expensive.
 *
 * It does not return a refresh token on a renewal. Writing the response
 * straight back over the stored grant would erase the only means of renewing it
 * again, and the connection would work for an hour and then be unrecoverable.
 *
 * `invalid_grant` means the user revoked access, or the token expired from
 * disuse. That is not a transient failure to retry: the connection is over, and
 * it must be marked so the channel asks to be reconnected instead of silently
 * collecting nothing.
 */
export class RevokedError extends ConnectError {
  constructor() {
    super("connection_revoked");
  }
}

export async function refreshAccessToken(
  refreshToken: string,
  config: CallbackConfig,
  http: Http,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: string;
}> {
  const response = await http(config.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    if (body.error === "invalid_grant") throw new RevokedError();
    throw new ConnectError("token_refresh_failed");
  }
  const access = body.access_token;
  if (typeof access !== "string" || !access)
    throw new ConnectError("token_refresh_failed");
  return {
    access_token: access,
    // Kept, not replaced. Google omits it here, and taking the response at face
    // value would drop the only way to renew again.
    refresh_token:
      typeof body.refresh_token === "string" && body.refresh_token
        ? body.refresh_token
        : refreshToken,
    expires_at: new Date(
      Date.now() +
        (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000,
    ).toISOString(),
  };
}
