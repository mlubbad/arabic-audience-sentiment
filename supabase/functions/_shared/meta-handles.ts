/**
 * Naming a Facebook page or an Instagram account from a pasted link.
 *
 * The lookup only names: it turns what a person pasted into a candidate the
 * browser can show and `register_public_channel` can file. Meta answers one
 * profile read without a login at the volume a lookup makes; when it does
 * not, the candidate is the bare handle and the row can still be added, as
 * X and TikTok do today. Nothing here reads comments.
 */

export type MetaCandidate = {
  external_channel_id: string;
  handle: string | null;
  title: string | null;
  thumbnail_url: string | null;
  platform: "facebook" | "instagram";
};

export type MetaLookup = {
  candidates: MetaCandidate[];
  fallback_available?: boolean;
};

export class MetaLookupError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const IG_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "explore",
  "stories",
  "accounts",
  "direct",
  "tv",
]);
const FB_RESERVED = new Set([
  "groups",
  "events",
  "marketplace",
  "watch",
  "gaming",
  "pages",
  "profile.php",
  "posts",
]);

/** Instagram's web app id; a public constant every browser sends. */
const IG_APP_ID = "936619743392459";

export function parseInstagramHandle(raw: string): string | null {
  let s = (raw ?? "").trim();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^(www\.)?instagram\.com\//i, "");
  s = s.replace(/^\/+/, "").replace(/^@/, "");
  s = s.split("?")[0].split("#")[0];
  const first = s.split("/")[0];
  if (!first || IG_RESERVED.has(first) || !/^[A-Za-z0-9_.]{1,30}$/.test(first))
    return null;
  return first;
}

export function parseFacebookHandle(raw: string): string | null {
  let s = (raw ?? "").trim();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^(www\.|m\.|web\.|mbasic\.)?facebook\.com\//i, "");
  s = s.replace(/^\/+/, "");
  const profile = s.match(/^profile\.php\?id=([0-9]{1,64})/);
  if (profile) return profile[1];
  const pages = s.match(/^pages\/[^/]+\/([0-9]{1,64})/);
  if (pages) return pages[1];
  s = s.split("?")[0].split("#")[0].replace(/\/+$/, "");
  if (!s || s.includes("/") || FB_RESERVED.has(s)) return null;
  if (!/^[A-Za-z0-9.]{1,80}$/.test(s)) return null;
  return s;
}

const bare = (
  handle: string,
  platform: MetaCandidate["platform"],
  shownHandle: string,
): MetaLookup => ({
  candidates: [
    {
      external_channel_id: handle,
      handle: shownHandle,
      title: shownHandle,
      thumbnail_url: null,
      platform,
    },
  ],
  fallback_available: true,
});

export async function instagramProfileCandidate(
  handle: string,
  http: Fetch,
  timeoutMs = 6000,
): Promise<MetaLookup> {
  let response: Response;
  try {
    response = await http(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      {
        method: "GET",
        headers: {
          "x-ig-app-id": IG_APP_ID,
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch {
    return bare(handle, "instagram", `@${handle}`);
  }
  if (response.status === 404)
    throw new MetaLookupError("channel_not_found", 404);
  if (!response.ok) return bare(handle, "instagram", `@${handle}`);
  // A 200 that is not the profile JSON (an HTML login wall, a "useragent
  // mismatch" body) is a refusal to name, not a missing account: the add
  // stays possible on the bare handle. Only a parsed body whose user is
  // explicitly null is Instagram's "this does not exist".
  let body: { data?: { user?: unknown } } | null = null;
  try {
    body = (await response.json()) as { data?: { user?: unknown } };
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || !("data" in body))
    return bare(handle, "instagram", `@${handle}`);
  const user = body.data?.user as
    { full_name?: unknown; profile_pic_url?: unknown } | null | undefined;
  if (!user) throw new MetaLookupError("channel_not_found", 404);
  const title =
    typeof user.full_name === "string" && user.full_name.trim()
      ? user.full_name.trim().slice(0, 200)
      : `@${handle}`;
  return {
    candidates: [
      {
        external_channel_id: handle,
        handle: `@${handle}`,
        title,
        thumbnail_url:
          typeof user.profile_pic_url === "string" && user.profile_pic_url
            ? user.profile_pic_url
            : null,
        platform: "instagram",
      },
    ],
  };
}

const meta = (html: string, property: string): string | null => {
  const m =
    html.match(
      new RegExp(
        `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
        "i",
      ),
    ) ??
    html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
        "i",
      ),
    );
  return m ? m[1].trim() : null;
};

export async function facebookPageCandidate(
  handle: string,
  http: Fetch,
  timeoutMs = 6000,
): Promise<MetaLookup> {
  let response: Response;
  try {
    response = await http(
      `https://www.facebook.com/${encodeURIComponent(handle)}/`,
      {
        method: "GET",
        headers: {
          // The crawler agent gets the Open Graph head without a login wall.
          "user-agent": "facebookexternalhit/1.1",
          accept: "text/html",
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch {
    return bare(handle, "facebook", handle);
  }
  if (response.status === 404)
    throw new MetaLookupError("channel_not_found", 404);
  if (!response.ok) return bare(handle, "facebook", handle);
  const html = await response.text().catch(() => "");
  const title = meta(html, "og:title");
  if (!title) return bare(handle, "facebook", handle);
  const image = meta(html, "og:image");
  return {
    candidates: [
      {
        external_channel_id: handle,
        handle,
        title: title.replace(/&amp;/g, "&").slice(0, 200),
        thumbnail_url: image ? image.replace(/&amp;/g, "&") : null,
        platform: "facebook",
      },
    ],
  };
}
