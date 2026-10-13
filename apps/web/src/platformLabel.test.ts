/** One place names a platform, its "open on" link and its cataloguing note. */
import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import {
  catalogueRunningDetail,
  openOnLabel,
  platformLabel,
} from "./platformLabel";

describe("platformLabel", () => {
  it("names all six platforms and shows an unknown value as is", () => {
    expect(platformLabel("youtube", ar)).toBe(ar.platformYouTube);
    expect(platformLabel("telegram", ar)).toBe(ar.platformTelegram);
    expect(platformLabel("x", ar)).toBe(ar.platformX);
    expect(platformLabel("tiktok", ar)).toBe(ar.platformTikTok);
    expect(platformLabel("facebook", ar)).toBe(ar.platformFacebook);
    expect(platformLabel("instagram", ar)).toBe(ar.platformInstagram);
    expect(platformLabel("myspace", ar)).toBe("myspace");
    expect(platformLabel(null, ar)).toBe("");
  });

  it("says where a post opens, YouTube when the platform is unknown", () => {
    expect(openOnLabel("facebook", ar)).toBe(ar.catOpenFacebook);
    expect(openOnLabel("instagram", ar)).toBe(ar.catOpenInstagram);
    expect(openOnLabel("tiktok", ar)).toBe(ar.catOpenTikTok);
    expect(openOnLabel(undefined, ar)).toBe(ar.catOpenYouTube);
  });

  it("describes the running catalogue per platform, generically otherwise", () => {
    expect(catalogueRunningDetail("facebook", ar)).toBe(
      ar.jobCatalogueRunningDetailFacebook,
    );
    expect(catalogueRunningDetail("instagram", ar)).toBe(
      ar.jobCatalogueRunningDetailInstagram,
    );
    expect(catalogueRunningDetail("x", ar)).toBe(ar.jobCatalogueRunningDetailX);
    expect(catalogueRunningDetail("youtube", ar)).toBe(
      ar.jobCatalogueRunningDetail,
    );
  });
});
