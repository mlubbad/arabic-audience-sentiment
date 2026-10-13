/**
 * The five public platforms, one registry: how a pasted link becomes the
 * candidate the card hands the page. The shapes here are the ones the page's
 * handlers always received; Facebook and Instagram join them.
 */
import { describe, expect, it } from "vitest";
import { PUBLIC_PLATFORMS, PUBLIC_PLATFORM_ORDER } from "./publicPlatforms";

describe("public platform registry", () => {
  it("lists the five platforms in the order the card shows them", () => {
    expect(PUBLIC_PLATFORM_ORDER).toEqual([
      "telegram",
      "x",
      "tiktok",
      "facebook",
      "instagram",
    ]);
    for (const p of PUBLIC_PLATFORM_ORDER)
      expect(PUBLIC_PLATFORMS[p].testId).toBe(`add${p}`);
  });

  it("cleans Telegram, X and TikTok exactly as the card did", () => {
    expect(
      PUBLIC_PLATFORMS.telegram.clean("https://t.me/tech_news_arabic"),
    ).toBe("@tech_news_arabic");
    expect(PUBLIC_PLATFORMS.telegram.clean("???")).toBeNull();
    expect(PUBLIC_PLATFORMS.x.clean("https://x.com/aljazeera")).toBe(
      "aljazeera",
    );
    expect(PUBLIC_PLATFORMS.x.clean("invalid handle with spaces!")).toBeNull();
    expect(
      PUBLIC_PLATFORMS.tiktok.clean("https://www.tiktok.com/@khaby.lame"),
    ).toBe("khaby.lame");
    expect(PUBLIC_PLATFORMS.tiktok.clean("a")).toBeNull();
  });

  it("hands back the candidates the page always received", () => {
    expect(PUBLIC_PLATFORMS.telegram.candidate("@tech_news_arabic")).toEqual({
      external_channel_id: "@tech_news_arabic",
      handle: "@tech_news_arabic",
      title: "@tech_news_arabic",
      thumbnail_url: null,
      platform: "telegram",
    });
    expect(PUBLIC_PLATFORMS.x.candidate("aljazeera")).toEqual({
      external_channel_id: "aljazeera",
      handle: "@aljazeera",
      title: "@aljazeera",
      thumbnail_url: null,
      platform: "x",
    });
    expect(PUBLIC_PLATFORMS.tiktok.candidate("khaby.lame")).toMatchObject({
      handle: "@khaby.lame",
      platform: "tiktok",
    });
  });

  it("cleans a Facebook page from its many link shapes", () => {
    const fb = PUBLIC_PLATFORMS.facebook.clean;
    expect(fb("https://www.facebook.com/aljazeera/")).toBe("aljazeera");
    expect(fb("m.facebook.com/aljazeera/")).toBe("aljazeera");
    expect(fb("https://www.facebook.com/profile.php?id=123")).toBe("123");
    expect(fb("facebook.com/pages/Name/456")).toBe("456");
    expect(fb("aljazeera.english")).toBe("aljazeera.english");
    expect(fb("https://www.facebook.com/groups/abc")).toBeNull();
    expect(fb("al jazeera")).toBeNull();
    expect(PUBLIC_PLATFORMS.facebook.candidate("aljazeera")).toEqual({
      external_channel_id: "aljazeera",
      handle: "aljazeera",
      title: "aljazeera",
      thumbnail_url: null,
      platform: "facebook",
    });
  });

  it("cleans an Instagram account and refuses a post link", () => {
    const ig = PUBLIC_PLATFORMS.instagram.clean;
    expect(ig("@natgeo")).toBe("natgeo");
    expect(ig("https://www.instagram.com/natgeo/")).toBe("natgeo");
    expect(ig("instagram.com/natgeo/reels/?hl=ar")).toBe("natgeo");
    expect(ig("https://www.instagram.com/p/DLNsnpUTdVS/")).toBeNull();
    expect(ig("instagram.com/reel/abc")).toBeNull();
    expect(ig("a b")).toBeNull();
    expect(PUBLIC_PLATFORMS.instagram.candidate("natgeo")).toEqual({
      external_channel_id: "natgeo",
      handle: "@natgeo",
      title: "@natgeo",
      thumbnail_url: null,
      platform: "instagram",
    });
  });
});
