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
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { corsHeaders, parseOrigins, preflight } from "../_shared/cors.ts";
import { parseChannelQuery } from "../_shared/channel-query.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const allowed = parseOrigins(Deno.env.get("ALLOWED_ORIGINS"));

/** One candidate: exactly what `register_public_channel` takes, plus a face. */
interface Candidate {
  external_channel_id: string;
  handle: string | null;
  title: string | null;
  thumbnail_url: string | null;
}

class LookupError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

/** One YouTube Data API call. Refusals become our own codes, with Google's
 *  reason where it names the problem (quota, key, availability). */
async function ytGet(
  key: string,
  resource: string,
  params: Record<string, string>,
) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new LookupError("source_unavailable", 502);
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

async function lookup(key: string, raw: string): Promise<Candidate[]> {
  const query = parseChannelQuery(raw);
  if (!query) throw new LookupError("invalid_query", 400);

  if (query.kind === "search") {
    // search.list names ids only; the details call fills in handle and face,
    // one unit for up to fifty — small beside the search's hundred.
    const found = await ytGet(key, "search", {
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
    const details = await ytGet(key, "channels", {
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
  const data = await ytGet(key, "channels", params);
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

  let body: { workspace_id?: string; query?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { code: "invalid_request" });
  }
  if (!body.workspace_id || !body.query)
    return json(400, { code: "invalid_request" });

  // Membership first, before the key is spent: a caller who is not a member
  // of the named workspace gets the same refusal they would from any other
  // door, and the project's quota is not the public's to use.
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization: auth } },
  });
  const { data: memberships, error: memberError } = await db
    .from("memberships")
    .select("role")
    .eq("workspace_id", body.workspace_id);
  if (memberError) return json(403, { code: "forbidden" });
  if (!memberships?.length) return json(403, { code: "forbidden" });

  const key = env("YOUTUBE_API_KEY");
  if (!key) return json(500, { code: "lookup_not_configured" });

  try {
    return json(200, { candidates: await lookup(key, body.query) });
  } catch (error) {
    if (error instanceof LookupError)
      return json(error.status, { code: error.code });
    return json(500, { code: "control_plane_error" });
  }
});
