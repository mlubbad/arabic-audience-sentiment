/**
 * Names a public channel from its link, its handle, or a search.
 *
 * The alternative door to OAuth: with a project API key, a channel's public
 * data is readable without the owner's consent, so a workspace can add a
 * channel by sharing its link or by searching for it. This function does only
 * the naming — it answers "which channel did you mean" with candidates — and
 * files nothing. The row is written by `register_public_channel`, called by
 * the browser with the user's own JWT, so the role check and the tenant check
 * stay in the database where every other write's are.
 *
 * Needs `YOUTUBE_API_KEY` as a function secret (`supabase secrets set`). A
 * search costs 100 quota units of the project's daily 10,000; naming a
 * channel by id, handle or username costs 1. The unit costs are the caller's
 * to know — the lookup returns a `quota_exceeded` refusal when Google says
 * the day's allowance is spent.
 */
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.58.0";
import {
  importSealingKey,
  openTokens,
  refreshAccessToken,
} from "../_shared/oauth-callback.ts";
import { corsHeaders, parseOrigins, preflight } from "../_shared/cors.ts";
import { parseChannelQuery } from "../_shared/channel-query.ts";
import {
  facebookPageCandidate,
  instagramProfileCandidate,
  MetaLookupError,
  parseFacebookHandle,
  parseInstagramHandle,
} from "../_shared/meta-handles.ts";
import { lookupRefusal, refusalDetail } from "../_shared/lookup-access.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const allowed = parseOrigins(Deno.env.get("ALLOWED_ORIGINS"));

/** One candidate: exactly what `register_public_channel` takes, plus a face. */
interface Candidate {
  external_channel_id: string;
  handle: string | null;
  title: string | null;
  thumbnail_url: string | null;
  platform?: "youtube" | "telegram" | "x" | "tiktok" | "facebook" | "instagram";
}

class LookupError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

/**
 * The credential for one YouTube Data API call: a project API key passed as
 * the `key` parameter, or a bearer token — the platform reader's grant — in
 * the authorization header. Refusals become our own codes, with Google's
 * reason where it names the problem (quota, key, availability).
 */
async function ytGet(
  credential: { key?: string; token?: string },
  resource: string,
  params: Record<string, string>,
) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (credential.key) url.searchParams.set("key", credential.key);
  const headers: Record<string, string> = {};
  if (credential.token) headers["authorization"] = `Bearer ${credential.token}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LookupError("source_unavailable", 502);
  }
  if (response.status === 401) {
    // The reader's access token lapsed; its holder refreshes before the next
    // call. Here it is a dead credential for this request.
    throw new LookupError("reader_token_lapsed", 502);
  }
  if (response.status === 403 || response.status === 429) {
    // A quota refusal and a key refusal both arrive as 403; the reason is
    // Google's own name for which it was, and the caller's action differs.
    let reason = "";
    try {
      const body = await response.json();
      reason = body?.error?.errors?.[0]?.reason ?? "";
    } catch {
      // The body is still the refusal's, not ours to trust.
    }
    if (/quota|rate/i.test(reason))
      throw new LookupError("quota_exceeded", 429);
    throw new LookupError(`source_access_denied:${reason}`, 403);
  }
  if (response.status === 400) throw new LookupError("invalid_query", 400);
  if (response.status >= 500) throw new LookupError("source_unavailable", 502);
  if (response.status !== 200) throw new LookupError("source_http_error", 502);
  const data = await response.json();
  if (!data || !Array.isArray(data.items))
    throw new LookupError("invalid_response", 502);
  return data;
}

function candidate(item: Record<string, unknown>): Candidate | null {
  const s = (item.snippet ?? {}) as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : "";
  // The id is the channel's identity and the only field the registration
  // checks; an item without a well-formed one is not a candidate, whatever
  // else the source said about it.
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(id)) return null;
  const thumbs = (s.thumbnails ?? {}) as Record<string, { url?: string }>;
  return {
    external_channel_id: id,
    handle: typeof s.customUrl === "string" && s.customUrl ? s.customUrl : null,
    title: typeof s.title === "string" && s.title ? s.title : null,
    thumbnail_url:
      typeof thumbs.medium?.url === "string"
        ? thumbs.medium.url
        : typeof thumbs.default?.url === "string"
          ? thumbs.default.url
          : null,
  };
}

async function lookup(
  credential: { key?: string; token?: string },
  raw: string,
): Promise<Candidate[]> {
  const query = parseChannelQuery(raw);
  if (!query) throw new LookupError("invalid_query", 400);

  if (query.kind === "search") {
    // When the query is a single handle-shaped token (e.g. from `/c/ChannelName`
    // or a bare handle typed without `@`), try `channels.list(forHandle=...)`
    // first (1 quota unit) before spending 100 quota units on `search.list`.
    if (/^[A-Za-z0-9._-]{3,30}$/.test(query.value)) {
      const byHandle = await ytGet(credential, "channels", {
        part: "snippet",
        forHandle: `@${query.value}`,
      });
      const matched = byHandle.items
        .map(candidate)
        .filter((c: Candidate | null): c is Candidate => c !== null);
      if (matched.length > 0) return matched;
    }
    // search.list names ids only; the details call fills in handle and face,
    // one unit for up to fifty — small beside the search's hundred.
    const found = await ytGet(credential, "search", {
      part: "snippet",
      type: "channel",
      maxResults: "5",
      q: query.value,
    });
    const ids = found.items
      .map((i: Record<string, unknown>) =>
        typeof i.id === "object" && i.id
          ? (i.id as Record<string, unknown>).channelId
          : null,
      )
      .filter((v: unknown): v is string => typeof v === "string")
      .slice(0, 5);
    if (!ids.length) return [];
    const details = await ytGet(credential, "channels", {
      part: "snippet",
      id: ids.join(","),
    });
    return details.items
      .map(candidate)
      .filter((c: Candidate | null): c is Candidate => c !== null);
  }

  const params: Record<string, string> = { part: "snippet" };
  if (query.kind === "id") params.id = query.value;
  else if (query.kind === "handle") {
    // The API reads the handle with its @; the parser strips it.
    params.forHandle = `@${query.value}`;
  } else params.forUsername = query.value;
  const data = await ytGet(credential, "channels", params);
  return data.items
    .map(candidate)
    .filter((c: Candidate | null): c is Candidate => c !== null);
}

Deno.serve(async (request) => {
  const pre = preflight(request, allowed);
  if (pre) return pre;

  const json = (code: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status: code,
      headers: {
        "content-type": "application/json",
        ...corsHeaders(request, allowed),
      },
    });

  if (request.method !== "POST")
    return json(405, { code: "method_not_allowed" });
  const auth = request.headers.get("authorization");
  if (!auth) return json(401, { code: "unauthenticated" });

  let body: { workspace_id?: string; query?: string; platform?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { code: "invalid_request" });
  }
  if (!body.workspace_id || !body.query)
    return json(400, { code: "invalid_request" });

  const platform = body.platform || "youtube";

  // Membership first, before any external quota/resource is spent:
  // a caller who is not a member of the named workspace gets 403.
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization: auth } },
  });
  // The token is verified by PostgREST and the role is the caller's own; no
  // separate Auth `/user` call (see `_shared/lookup-access.ts`).
  const { data: role, error: roleError } = await db.rpc("my_role", {
    w: body.workspace_id,
  });
  const refusal = lookupRefusal({
    role: typeof role === "string" ? role : null,
    roleError,
  });
  if (refusal) {
    console.error("channel-lookup refused", {
      code: refusal,
      ...refusalDetail(roleError),
    });
    return json(403, { code: refusal });
  }

  if (platform === "telegram") {
    let clean = body.query.trim();
    clean = clean.replace(/^https?:\/\/(www\.)?t\.me\//i, "");
    clean = clean.replace(/^t\.me\//i, "");
    clean = clean.replace(/^\/?@?/, "");
    clean = clean.replace(/\/.*$/, "").replace(/\?.*$/, "").trim();
    if (!clean || !/^[A-Za-z0-9_]{4,64}$/.test(clean)) {
      return json(400, { code: "invalid_query" });
    }
    const handle = `@${clean}`;
    try {
      const res = await fetch(`https://t.me/s/${clean}`, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; SentimentBot/1.0)" },
        signal: AbortSignal.timeout(6000),
      });
      if (res.status === 404) {
        return json(404, { code: "channel_not_found" });
      }
      const html = await res.text();
      if (
        html.includes("<title>Telegram: Contact @") &&
        !html.includes("tgme_channel_info")
      ) {
        return json(400, { code: "channel_not_public" });
      }
      const titleMatch =
        html.match(/<meta property="og:title" content="([^"]+)">/) ||
        html.match(
          /class="tgme_page_title"[^>]*><span dir="auto">([^<]+)<\/span>/,
        ) ||
        html.match(
          /class="tgme_channel_info_title"[^>]*><span dir="auto">([^<]+)<\/span>/,
        );
      const imgMatch =
        html.match(/<meta property="og:image" content="([^"]+)">/) ||
        html.match(/class="tgme_page_photo_image" [^>]*src="([^"]+)"/);

      const title = titleMatch ? titleMatch[1].trim() : handle;
      const thumbnail_url = imgMatch ? imgMatch[1].trim() : null;

      return json(200, {
        candidates: [
          {
            external_channel_id: handle,
            handle,
            title,
            thumbnail_url,
            platform: "telegram",
          },
        ],
      });
    } catch {
      // In case public preview is blocked or network times out, return candidate with fallback indicator
      return json(200, {
        candidates: [
          {
            external_channel_id: handle,
            handle,
            title: handle,
            thumbnail_url: null,
            platform: "telegram",
          },
        ],
        fallback_available: true,
      });
    }
  }

  if (platform === "x") {
    let clean = body.query.trim();
    clean = clean.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "");
    clean = clean.replace(/^(twitter|x)\.com\//i, "");
    clean = clean.replace(/^\/?@?/, "");
    clean = clean.replace(/\/.*$/, "").replace(/\?.*$/, "").trim();
    if (!clean || !/^[A-Za-z0-9_]{1,15}$/.test(clean)) {
      return json(400, { code: "invalid_query" });
    }
    const handle = `@${clean}`;
    return json(200, {
      candidates: [
        {
          external_channel_id: clean,
          handle,
          title: handle,
          thumbnail_url: null,
          platform: "x",
        },
      ],
      fallback_available: true,
    });
  }

  if (platform === "tiktok") {
    let clean = body.query.trim();
    clean = clean.replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "");
    clean = clean.replace(/^tiktok\.com\/@?/i, "");
    clean = clean.replace(/^\/?@?/, "");
    clean = clean.replace(/\/.*$/, "").replace(/\?.*$/, "").trim();
    if (!clean || !/^[A-Za-z0-9_.-]{2,30}$/.test(clean)) {
      return json(400, { code: "invalid_query" });
    }
    const handle = `@${clean}`;
    return json(200, {
      candidates: [
        {
          external_channel_id: clean,
          handle,
          title: handle,
          thumbnail_url: null,
          platform: "tiktok",
        },
      ],
      fallback_available: true,
    });
  }

  if (platform === "instagram" || platform === "facebook") {
    // Named from a public profile read; refused reads fall back to the bare
    // handle, which the person can still add (the worker reads through the
    // scrapers either way). A 404 is the one answer that stops the add.
    const handle =
      platform === "instagram"
        ? parseInstagramHandle(body.query)
        : parseFacebookHandle(body.query);
    if (!handle) return json(400, { code: "invalid_query" });
    try {
      const named =
        platform === "instagram"
          ? await instagramProfileCandidate(handle, (u, init) => fetch(u, init))
          : await facebookPageCandidate(handle, (u, init) => fetch(u, init));
      return json(200, named);
    } catch (error) {
      if (error instanceof MetaLookupError)
        return json(error.status, { code: error.code });
      return json(500, { code: "control_plane_error" });
    }
  }

  // The reading credential: the project API key when one is set, otherwise
  // the platform reader — the operator's own OAuth grant, sealed in the
  // database and opened here with the platform's key. Google's new key
  // format is refused by the YouTube endpoint (20260919200000's header tells
  // the story), so the reader is what makes this door work at all.
  const key = env("YOUTUBE_API_KEY");
  const credential: { key?: string; token?: string } = key
    ? { key }
    : {
        token: await readerToken(
          createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY")),
        ),
      };
  if (!credential.key && !credential.token)
    return json(500, { code: "lookup_not_configured" });

  try {
    const rawCandidates = await lookup(credential, body.query);
    const ytCandidates = rawCandidates.map((c) => ({
      ...c,
      platform: "youtube" as const,
    }));
    return json(200, { candidates: ytCandidates });
  } catch (error) {
    if (error instanceof LookupError)
      return json(error.status, { code: error.code });
    return json(500, { code: "control_plane_error" });
  }
});

/**
 * The platform reader's access token, unsealed and freshened in memory.
 *
 * A lapsed access token is refreshed here but never written back — the
 * worker's claim path owns the stored seal's renewal, and lookups are
 * sporadic enough that an occasional extra refresh costs nothing. No reader
 * row, no token: the door then says it is not configured.
 */
async function readerToken(db: SupabaseClient): Promise<string | undefined> {
  const sealingKey = env("TOKEN_ENCRYPTION_KEY");
  if (!sealingKey) return undefined;
  const { data, error } = (await db.rpc(
    "channel_lookup_reader_grant",
  )) as unknown as {
    data: { encrypted_tokens: string }[] | null;
    error: { message?: string } | null;
  };
  if (error || !data?.length) return undefined;
  const grant = data[0] as { encrypted_tokens: string };
  const hex = grant.encrypted_tokens.replace(/^\\x/, "");
  const sealed = new Uint8Array(
    hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? [],
  );
  const key = await importSealingKey(sealingKey);
  const tokens = (await openTokens(key, sealed)) as {
    access_token: string;
    refresh_token: string;
    expires_at: string;
  };
  if (Date.parse(tokens.expires_at) - Date.now() > 60_000)
    return tokens.access_token;
  const renewed = await refreshAccessToken(
    tokens.refresh_token,
    {
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: env("GOOGLE_REDIRECT_URI"),
      token_uri: "https://oauth2.googleapis.com/token",
      key_version: env("TOKEN_ENCRYPTION_KEY_VERSION") || "k1",
    },
    (u, init) => fetch(u, init),
  );
  return renewed.access_token;
}
