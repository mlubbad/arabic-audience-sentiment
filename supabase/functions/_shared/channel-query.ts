/**
 * What a channel lookup was asked for, parsed.
 *
 * The lookup function takes one string that may be any of the ways a channel
 * is named in the wild — a full URL, a bare handle, a UC id, or just words to
 * search — and this turns it into the one YouTube Data API question that
 * answers it. Pure, so the table of forms is testable without the network.
 *
 * The cost asymmetry drives the shapes: naming a channel directly
 * (channels.list by id, forHandle or forUsername) costs 1 quota unit, while
 * search.list costs 100. A `/c/` vanity URL is deliberately a search rather
 * than a guess — the vanity name is not the handle, and there is no direct
 * lookup for it — but the path's tail is usually the right query.
 */
export type ChannelQuery =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "username"; value: string }
  | { kind: "search"; value: string };

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[\p{L}\p{N}._-]{3,30}$/u;

export function parseChannelQuery(raw: string): ChannelQuery | null {
  const input = raw.trim();
  if (!input || input.length > 300) return null;
  // A bare UC id is unambiguous, and it must be decided before the URL
  // attempt: `https://` + an id parses as a URL whose host is the id.
  if (CHANNEL_ID.test(input)) return { kind: "id", value: input };
  if (input.startsWith("@")) {
    return HANDLE.test(input) ? { kind: "handle", value: input.slice(1) } : null;
  }

  // Anything URL-shaped that is not a YouTube channel URL is a wrong input,
  // not a search: searching a pasted video link would return channels the
  // reader never meant. Plain words (even single Latin words without dots)
  // are queries, not hostnames.
  const isExplicitUrl = /^https?:\/\//i.test(input);
  const isYoutubePath = /^(?:www\.|m\.)?youtube\.com\//i.test(input);
  const isDomainLike = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(input);

  if (isExplicitUrl || isYoutubePath || isDomainLike) {
    let url: URL | null = null;
    try {
      url = new URL(isExplicitUrl ? input : `https://${input}`);
    } catch {
      url = null;
    }
    if (url) {
      if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
      const byId = url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/);
      if (byId) return { kind: "id", value: byId[1] };
      const byHandle = url.pathname.match(/^\/@([^/?#]+)/);
      if (byHandle) {
        const value = decodeURIComponent(byHandle[1]);
        return HANDLE.test(`@${value}`) ? { kind: "handle", value } : null;
      }
      const byUser = url.pathname.match(/^\/user\/([^/?#]+)/);
      if (byUser)
        return { kind: "username", value: decodeURIComponent(byUser[1]) };
      const byVanity = url.pathname.match(/^\/c\/([^/?#]+)/);
      if (byVanity)
        return { kind: "search", value: decodeURIComponent(byVanity[1]) };
      // A YouTube URL that names no channel — a video watch page, the home
      // page — cannot be answered by naming a channel.
      return null;
    }
  }

  // Words: the search path. The quota cost is the lookup function's to
  // document and the plan's to absorb; the parser only says what was asked.
  return { kind: "search", value: input };
}
