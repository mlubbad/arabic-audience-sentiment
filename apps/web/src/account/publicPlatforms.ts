/**
 * The public-data door, one platform at a time.
 *
 * Each entry says how a pasted link becomes the clean handle the lookup is
 * asked about, and what candidate the page is handed when the person adds
 * directly. The shapes are exactly what `Account.tsx`'s handlers received
 * before this registry existed: Telegram keeps its `@`, X/TikTok/Instagram
 * show `@handle` and store the bare one, Facebook stores and shows the
 * page's vanity name or numeric id.
 */
import type { ChannelCandidate } from "@sentiment/contracts";
import type { StringKey } from "../strings";

export type PublicPlatform =
  "telegram" | "x" | "tiktok" | "facebook" | "instagram";

export type PublicPlatformSpec = {
  label: StringKey;
  heading: StringKey;
  lead: StringKey;
  placeholder: StringKey;
  invalid: StringKey;
  /** The test-id prefix: `${testId}-form-…`, `-search-…`, `-submit-…`, `-close-…`. */
  testId: string;
  clean: (raw: string) => string | null;
  candidate: (clean: string) => ChannelCandidate;
};

const stripPath = (s: string) => s.replace(/\/.*$/, "").replace(/\?.*$/, "");

function cleanTelegram(raw: string): string | null {
  let s = raw.trim();
  s = s.replace(/^https?:\/\/(www\.)?t\.me\//i, "");
  s = s.replace(/^t\.me\//i, "");
  s = s.replace(/^\//, "");
  s = s.replace(/\/.*$/, "");
  if (!s) return null;
  if (!s.startsWith("@")) s = "@" + s;
  if (!/^@[A-Za-z0-9_]{4,64}$/.test(s)) return null;
  return s;
}

function cleanX(raw: string): string | null {
  let s = raw.trim();
  s = s.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "");
  s = s.replace(/^(twitter|x)\.com\//i, "");
  s = s.replace(/^\/?@?/, "");
  s = stripPath(s).trim();
  if (!s || !/^[A-Za-z0-9_]{1,15}$/.test(s)) return null;
  return s;
}

function cleanTikTok(raw: string): string | null {
  let s = raw.trim();
  s = s.replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "");
  s = s.replace(/^tiktok\.com\/@?/i, "");
  s = s.replace(/^\/?@?/, "");
  s = stripPath(s).trim();
  if (!s || !/^[A-Za-z0-9_.-]{2,30}$/.test(s)) return null;
  return s;
}

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

function cleanFacebook(raw: string): string | null {
  let s = raw.trim();
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

function cleanInstagram(raw: string): string | null {
  let s = raw.trim();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^(www\.)?instagram\.com\//i, "");
  s = s.replace(/^\/+/, "").replace(/^@/, "");
  s = s.split("?")[0].split("#")[0];
  const first = s.split("/")[0];
  if (!first || IG_RESERVED.has(first) || !/^[A-Za-z0-9_.]{1,30}$/.test(first))
    return null;
  return first;
}

const atHandle =
  (platform: PublicPlatform) =>
  (clean: string): ChannelCandidate => ({
    external_channel_id: clean,
    handle: "@" + clean,
    title: "@" + clean,
    thumbnail_url: null,
    platform,
  });

const bareHandle =
  (platform: PublicPlatform) =>
  (clean: string): ChannelCandidate => ({
    external_channel_id: clean,
    handle: clean,
    title: clean,
    thumbnail_url: null,
    platform,
  });

export const PUBLIC_PLATFORM_ORDER: readonly PublicPlatform[] = [
  "telegram",
  "x",
  "tiktok",
  "facebook",
  "instagram",
];

export const PUBLIC_PLATFORMS: Record<PublicPlatform, PublicPlatformSpec> = {
  telegram: {
    label: "platformTelegram",
    heading: "addTelegramChannel",
    lead: "addTelegramLead",
    placeholder: "addTelegramPlaceholder",
    invalid: "addTelegramInvalidHandle",
    testId: "addtelegram",
    clean: cleanTelegram,
    candidate: bareHandle("telegram"),
  },
  x: {
    label: "platformX",
    heading: "addXChannel",
    lead: "addXLead",
    placeholder: "addXPlaceholder",
    invalid: "addXInvalidHandle",
    testId: "addx",
    clean: cleanX,
    candidate: atHandle("x"),
  },
  tiktok: {
    label: "platformTikTok",
    heading: "addTikTokChannel",
    lead: "addTikTokLead",
    placeholder: "addTikTokPlaceholder",
    invalid: "addTikTokInvalidHandle",
    testId: "addtiktok",
    clean: cleanTikTok,
    candidate: atHandle("tiktok"),
  },
  facebook: {
    label: "platformFacebook",
    heading: "addFacebookChannel",
    lead: "addFacebookLead",
    placeholder: "addFacebookPlaceholder",
    invalid: "addFacebookInvalidHandle",
    testId: "addfacebook",
    clean: cleanFacebook,
    candidate: bareHandle("facebook"),
  },
  instagram: {
    label: "platformInstagram",
    heading: "addInstagramChannel",
    lead: "addInstagramLead",
    placeholder: "addInstagramPlaceholder",
    invalid: "addInstagramInvalidHandle",
    testId: "addinstagram",
    clean: cleanInstagram,
    candidate: atHandle("instagram"),
  },
};
