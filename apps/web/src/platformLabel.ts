/** A platform's name in the reader's language; an unknown value is shown as is. */
import type { Strings } from "./strings";

export function platformLabel(
  platform: string | null | undefined,
  S: Strings,
): string {
  switch (platform) {
    case "youtube":
      return S.platformYouTube;
    case "telegram":
      return S.platformTelegram;
    case "x":
      return S.platformX;
    case "tiktok":
      return S.platformTikTok;
    case "facebook":
      return S.platformFacebook;
    case "instagram":
      return S.platformInstagram;
    default:
      return platform ?? "";
  }
}
