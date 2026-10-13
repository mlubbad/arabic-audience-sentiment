/**
 * Connecting a Facebook page or an Instagram account through Meta.
 *
 * Same shape as the Google half of oauth-callback.ts: exchange the code,
 * find out whose channel it is from Meta rather than from the caller, and
 * hand back tokens ready to be sealed. Two things differ from Google.
 *
 * Meta's long-lived tokens renew differently per door. A page token minted
 * from a long-lived user token does not expire, so it is stored with no
 * refresh token and an expiry years away. An Instagram token lives sixty
 * days and renews from itself (`ig_refresh_token`), so its refresh token is
 * the token itself.
 *
 * Meta's error bodies quote the request; only the numeric code is read.
 */
import { ConnectError, RevokedError, type Http } from "./oauth-callback.ts";

export interface MetaConfig {
  /** The Meta app (Facebook Login). */
  app_id: string;
  app_secret: string;
  /** The Instagram app id Meta issues under the same app, for Instagram Login. */
  ig_app_id: string;
  ig_app_secret: string;
  /** The one oauth-callback function; identical for both doors. */
  redirect_uri: string;
  key_version: string;
}

export const GRAPH_FACEBOOK = "https://graph.facebook.com/v25.0";
export const GRAPH_INSTAGRAM = "https://graph.instagram.com/v25.0";
export const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
];
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
];

/** Page tokens from a long-lived user token do not expire; this is "far enough". */
const PAGE_TOKEN_LIFETIME_MS = 3650 * 24 * 3600_000;

export type MetaTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  provider: "facebook" | "instagram";
};

export type MetaConnection = {
  external_channel: string;
  handle: string | null;
  title: string | null;
  tokens: MetaTokens;
  scopes: string[];
};

/** Meta's numeric error code from a refusal body, or null when it gave none. */
async function errorCode(response: Response): Promise<number | null> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "number" ? body.error.code : null;
  } catch {
    return null;
  }
}

const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

async function readToken(
  response: Response,
  failure: string,
): Promise<{ access_token: string; expires_in: number | null }> {
  if (!response.ok) throw new ConnectError(failure);
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (typeof body.access_token !== "string" || !body.access_token)
    throw new ConnectError(failure);
  return {
    access_token: body.access_token,
    expires_in: typeof body.expires_in === "number" ? body.expires_in : null,
  };
}

export async function connectFacebookPage(
  code: string,
  config: MetaConfig,
  http: Http,
): Promise<MetaConnection> {
  const exchange = new URL(`${GRAPH_FACEBOOK}/oauth/access_token`);
  exchange.search = new URLSearchParams({
    client_id: config.app_id,
    client_secret: config.app_secret,
    redirect_uri: config.redirect_uri,
    code,
  }).toString();
  const short = await readToken(
    await http(exchange.toString(), { method: "GET" }),
    "meta_token_exchange_failed",
  );

  const upgrade = new URL(`${GRAPH_FACEBOOK}/oauth/access_token`);
  upgrade.search = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: config.app_id,
    client_secret: config.app_secret,
    fb_exchange_token: short.access_token,
  }).toString();
  const long = await readToken(
    await http(upgrade.toString(), { method: "GET" }),
    "meta_token_exchange_failed",
  );

  const pagesResponse = await http(
    `${GRAPH_FACEBOOK}/me/accounts?fields=id,name,username,access_token`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${long.access_token}` },
    },
  );
  if (!pagesResponse.ok) {
    const code = await errorCode(pagesResponse);
    console.error("me/accounts refused", pagesResponse.status, code ?? "-");
    if (code === 10 || code === 200 || code === 230)
      throw new ConnectError("meta_scope_missing");
    throw new ConnectError("channel_lookup_failed");
  }
  const body = (await pagesResponse.json().catch(() => ({}))) as {
    data?: {
      id?: unknown;
      name?: unknown;
      username?: unknown;
      access_token?: unknown;
    }[];
  };
  const pages = (body.data ?? []).filter(
    (p) => typeof p?.id === "string" && typeof p?.access_token === "string",
  );
  // No page is a real answer: the account authorised fine and manages nothing.
  if (pages.length === 0) throw new ConnectError("meta_no_page");
  // More than one cannot be chosen server-side without guessing.
  if (pages.length > 1) throw new ConnectError("ambiguous_channel");
  const page = pages[0];
  return {
    external_channel: page.id as string,
    handle: text(page.username, 100),
    title: text(page.name, 200),
    tokens: {
      access_token: page.access_token as string,
      refresh_token: "",
      expires_at: new Date(Date.now() + PAGE_TOKEN_LIFETIME_MS).toISOString(),
      provider: "facebook",
    },
    scopes: [...FACEBOOK_SCOPES],
  };
}

export async function connectInstagramAccount(
  code: string,
  config: MetaConfig,
  http: Http,
): Promise<MetaConnection> {
  const short = await readToken(
    await http("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.ig_app_id,
        client_secret: config.ig_app_secret,
        grant_type: "authorization_code",
        redirect_uri: config.redirect_uri,
        code,
      }).toString(),
    }),
    "meta_token_exchange_failed",
  );

  const upgrade = new URL("https://graph.instagram.com/access_token");
  upgrade.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: config.ig_app_secret,
    access_token: short.access_token,
  }).toString();
  const long = await readToken(
    await http(upgrade.toString(), { method: "GET" }),
    "meta_token_exchange_failed",
  );

  const meResponse = await http(
    `${GRAPH_INSTAGRAM}/me?fields=user_id,username,name`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${long.access_token}` },
    },
  );
  if (!meResponse.ok) {
    const code = await errorCode(meResponse);
    console.error("instagram me refused", meResponse.status, code ?? "-");
    if (code === 10 || code === 200 || code === 230)
      throw new ConnectError("meta_scope_missing");
    throw new ConnectError("channel_lookup_failed");
  }
  const me = (await meResponse.json().catch(() => ({}))) as {
    user_id?: unknown;
    username?: unknown;
    name?: unknown;
  };
  // Only a professional (business or creator) account carries a user_id here.
  const userId =
    typeof me.user_id === "string" && me.user_id
      ? me.user_id
      : typeof me.user_id === "number"
        ? String(me.user_id)
        : null;
  if (!userId) throw new ConnectError("instagram_not_professional");
  const username = text(me.username, 100);
  return {
    external_channel: userId,
    handle: username ? `@${username.replace(/^@/, "")}` : null,
    title: text(me.name, 200) ?? username,
    tokens: {
      access_token: long.access_token,
      refresh_token: long.access_token,
      expires_at: new Date(
        Date.now() + (long.expires_in ?? 60 * 24 * 3600) * 1000,
      ).toISOString(),
      provider: "instagram",
    },
    scopes: [...INSTAGRAM_SCOPES],
  };
}

/**
 * Extends an Instagram token by another sixty days from itself.
 *
 * A 190 is a token Meta no longer honours — revoked, or left unrefreshed past
 * sixty days. That is not transient: the channel must ask to be reconnected.
 */
export async function refreshInstagramToken(
  accessToken: string,
  http: Http,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: string;
}> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.search = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: accessToken,
  }).toString();
  const response = await http(url.toString(), { method: "GET" });
  if (!response.ok) {
    const code = await errorCode(response);
    if (code === 190) throw new RevokedError();
    throw new ConnectError("token_refresh_failed");
  }
  const renewed = await readToken(response, "token_refresh_failed");
  return {
    access_token: renewed.access_token,
    refresh_token: renewed.access_token,
    expires_at: new Date(
      Date.now() + (renewed.expires_in ?? 60 * 24 * 3600) * 1000,
    ).toISOString(),
  };
}
