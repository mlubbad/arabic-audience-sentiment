/**
 * Naming a Facebook page or an Instagram account from what a person pasted.
 *
 * The parsers are pure; the candidate builders take an injected transport so
 * nothing here reaches Meta, and a refusal is a bare-handle candidate rather
 * than a failed lookup.
 */
import { describe, expect, it, vi } from "vitest";
import {
  facebookPageCandidate,
  instagramProfileCandidate,
  parseFacebookHandle,
  parseInstagramHandle,
} from "../functions/_shared/meta-handles";

describe("parseInstagramHandle", () => {
  it("takes a handle, a profile link, and a profile link with a trailing path", () => {
    expect(parseInstagramHandle("@natgeo")).toBe("natgeo");
    expect(parseInstagramHandle("https://www.instagram.com/natgeo/")).toBe(
      "natgeo",
    );
    expect(parseInstagramHandle("instagram.com/natgeo/reels/?hl=ar")).toBe(
      "natgeo",
    );
    expect(parseInstagramHandle("nat.geo_1")).toBe("nat.geo_1");
  });
  it("refuses a post, a reel, an explore link, and junk", () => {
    expect(
      parseInstagramHandle("https://www.instagram.com/p/DLNsnpUTdVS/"),
    ).toBeNull();
    expect(parseInstagramHandle("instagram.com/reel/abc")).toBeNull();
    expect(parseInstagramHandle("explore/tags/x")).toBeNull();
    expect(parseInstagramHandle("")).toBeNull();
    expect(parseInstagramHandle("a b")).toBeNull();
    expect(parseInstagramHandle("x".repeat(31))).toBeNull();
  });
});

describe("parseFacebookHandle", () => {
  it("takes a vanity name, a profile.php id, a pages path, and mobile hosts", () => {
    expect(parseFacebookHandle("https://www.facebook.com/aljazeera/")).toBe(
      "aljazeera",
    );
    expect(parseFacebookHandle("m.facebook.com/aljazeera?ref=x")).toBe(
      "aljazeera",
    );
    expect(
      parseFacebookHandle("https://www.facebook.com/profile.php?id=123456"),
    ).toBe("123456");
    expect(parseFacebookHandle("facebook.com/pages/Al-Jazeera/456789")).toBe(
      "456789",
    );
    expect(parseFacebookHandle("aljazeera.english")).toBe("aljazeera.english");
  });
  it("refuses groups, posts, spaces and empties", () => {
    expect(
      parseFacebookHandle("https://www.facebook.com/groups/abc"),
    ).toBeNull();
    expect(parseFacebookHandle("facebook.com/aljazeera/posts/123")).toBeNull();
    expect(parseFacebookHandle("al jazeera")).toBeNull();
    expect(parseFacebookHandle("")).toBeNull();
  });
});

const http = (status: number, body: string | object) =>
  vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      }),
  );

describe("instagramProfileCandidate", () => {
  it("names the account from the public profile endpoint", async () => {
    const h = http(200, {
      data: {
        user: {
          full_name: "National Geographic",
          profile_pic_url: "https://cdn/x.jpg",
          id: "17841400000",
        },
      },
    });
    const out = await instagramProfileCandidate("natgeo", h);
    expect(out).toEqual({
      candidates: [
        {
          external_channel_id: "natgeo",
          handle: "@natgeo",
          title: "National Geographic",
          thumbnail_url: "https://cdn/x.jpg",
          platform: "instagram",
        },
      ],
    });
    const [url, init] = h.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://www.instagram.com/api/v1/users/web_profile_info/?username=natgeo",
    );
    expect((init.headers as Record<string, string>)["x-ig-app-id"]).toBe(
      "936619743392459",
    );
  });
  it("a refused or blocked read falls back to the bare handle", async () => {
    const out = await instagramProfileCandidate(
      "natgeo",
      http(429, "slow down"),
    );
    expect(out).toEqual({
      candidates: [
        {
          external_channel_id: "natgeo",
          handle: "@natgeo",
          title: "@natgeo",
          thumbnail_url: null,
          platform: "instagram",
        },
      ],
      fallback_available: true,
    });
    const thrown = await instagramProfileCandidate(
      "natgeo",
      vi.fn(async () => {
        throw new Error("net");
      }),
    );
    expect(thrown.fallback_available).toBe(true);
  });
  it("a 404 is an account that does not exist", async () => {
    await expect(
      instagramProfileCandidate("nobody", http(404, "{}")),
    ).rejects.toMatchObject({ code: "channel_not_found", status: 404 });
  });
});

describe("facebookPageCandidate", () => {
  it("names the page from its Open Graph tags", async () => {
    const html =
      '<html><head><meta property="og:title" content="Al Jazeera Channel" /><meta property="og:image" content="https://cdn/p.jpg"></head></html>';
    const out = await facebookPageCandidate("aljazeera", http(200, html));
    expect(out).toEqual({
      candidates: [
        {
          external_channel_id: "aljazeera",
          handle: "aljazeera",
          title: "Al Jazeera Channel",
          thumbnail_url: "https://cdn/p.jpg",
          platform: "facebook",
        },
      ],
    });
  });
  it("a login wall or a refusal falls back to the bare handle; a 404 is not found", async () => {
    const out = await facebookPageCandidate(
      "aljazeera",
      http(200, "<html><title>Log in</title></html>"),
    );
    expect(out.fallback_available).toBe(true);
    expect(out.candidates[0]).toMatchObject({
      title: "aljazeera",
      thumbnail_url: null,
      platform: "facebook",
    });
    await expect(
      facebookPageCandidate("nobody", http(404, "")),
    ).rejects.toMatchObject({ code: "channel_not_found" });
  });
});
