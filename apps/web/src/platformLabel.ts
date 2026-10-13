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

/** "Open on …" for a post of this platform; YouTube when none is named. */
export function openOnLabel(
  platform: string | null | undefined,
  S: Strings,
): string {
  switch (platform) {
    case "telegram":
      return S.catOpenTelegram;
    case "x":
      return S.catOpenX;
    case "tiktok":
      return S.catOpenTikTok;
    case "facebook":
      return S.catOpenFacebook;
    case "instagram":
      return S.catOpenInstagram;
    default:
      return S.catOpenYouTube;
  }
}

/** What a running catalogue job is doing, in the platform's own words. */
export function catalogueRunningDetail(
  platform: string | null | undefined,
  S: Strings,
): string {
  switch (platform) {
    case "telegram":
      return S.jobCatalogueRunningDetailTelegram;
    case "x":
      return S.jobCatalogueRunningDetailX;
    case "tiktok":
      return S.jobCatalogueRunningDetailTikTok;
    case "facebook":
      return S.jobCatalogueRunningDetailFacebook;
    case "instagram":
      return S.jobCatalogueRunningDetailInstagram;
    default:
      return S.jobCatalogueRunningDetail;
  }
}
