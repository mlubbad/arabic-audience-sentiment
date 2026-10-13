/**
 * Connecting a Facebook page or an Instagram account: exchange, upgrade to a
 * long-lived token, identify the one page or account, and name the refusals.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ConnectError,
  RevokedError,
} from "../functions/_shared/oauth-callback";
import {
  connectFacebookPage,
  connectInstagramAccount,
  refreshInstagramToken,
  renewalDue,
  type MetaConfig,
} from "../functions/_shared/oauth-meta";

const config: MetaConfig = {
  app_id: "1234567890",
  app_secret: "not-a-real-app-secret",
  ig_app_id: "9876543210",
  ig_app_secret: "not-a-real-ig-secret",
  redirect_uri: "https://proj.supabase.co/functions/v1/oauth-callback",
  key_version: "k1",
};

type Reply = { status?: number; body: unknown };
function transport(
  routes: Record<string, Reply | ((url: string, init: RequestInit) => Reply)>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("{}", { status: 404 });
    const r =
      typeof routes[key] === "function" ? routes[key](url, init) : routes[key];
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return { http, calls };
}

const fbRoutes = (pages: unknown[]) => ({
  "/oauth/access_token?": (url: string) =>
    url.includes("fb_exchange_token")
      ? {
          body: {
            access_token: "EAALONG",
            token_type: "bearer",
            expires_in: 5184000,
          },
        }
      : {
          body: {
            access_token: "EAASHORT",
            token_type: "bearer",
            expires_in: 5000,
          },
        },
  "/me/accounts": { body: { data: pages } },
});

describe("connecting a Facebook page", () => {
  it("exchanges, upgrades, and picks the one page", async () => {
    const { http, calls } = transport(
      fbRoutes([
        {
          id: "100200300",
          name: "الجزيرة",
          username: "aljazeera",
          access_token: "EAAPAGE",
        },
      ]),
    );
    const before = Date.now();
    const out = await connectFacebookPage("auth-code", config, http);
    expect(out.external_channel).toBe("100200300");
    expect(out.handle).toBe("aljazeera");
    expect(out.title).toBe("الجزيرة");
    expect(out.tokens).toMatchObject({
      access_token: "EAAPAGE",
      refresh_token: "",
      provider: "facebook",
    });
    // A page token minted from a long-lived user token does not expire; it is stored as years away.
    expect(Date.parse(out.tokens.expires_at) - before).toBeGreaterThan(
      3000 * 24 * 3600_000,
    );
    expect(out.scopes).toEqual([
      "pages_show_list",
      "pages_read_engagement",
      "pages_read_user_content",
    ]);
    // The short-lived exchange, then the long-lived one, then the page list with the long-lived token.
    expect(calls[0].url).toContain(
      "https://graph.facebook.com/v25.0/oauth/access_token?",
    );
    expect(calls[0].url).toContain("code=auth-code");
    expect(calls[0].url).toContain("client_secret=not-a-real-app-secret");
    expect(calls[1].url).toContain("fb_exchange_token=EAASHORT");
    expect(calls[2].url).toContain(
      "/me/accounts?fields=id,name,username,access_token",
    );
    expect(calls[2].init.headers).toMatchObject({
      authorization: "Bearer EAALONG",
    });
  });

  it("two pages is ambiguous, none is meta_no_page", async () => {
    const two = transport(
      fbRoutes([
        { id: "1", name: "a", access_token: "x" },
        { id: "2", name: "b", access_token: "y" },
      ]),
    );
    await expect(
      connectFacebookPage("c", config, two.http),
    ).rejects.toMatchObject({ code: "ambiguous_channel" });
    const none = transport(fbRoutes([]));
    await expect(
      connectFacebookPage("c", config, none.http),
    ).rejects.toMatchObject({ code: "meta_no_page" });
  });

  it("names a refused exchange and a missing permission without quoting Meta", async () => {
    const bad = transport({
      "/oauth/access_token?": {
        status: 400,
        body: { error: { message: "secret stuff" } },
      },
    });
    const err = await connectFacebookPage("c", config, bad.http).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe("meta_token_exchange_failed");
    expect(String(err.message)).not.toContain("secret stuff");
    const noScope = transport({
      ...fbRoutes([]),
      "/me/accounts": {
        status: 400,
        body: { error: { code: 10, message: "(#10) needs pages_show_list" } },
      },
    });
    await expect(
      connectFacebookPage("c", config, noScope.http),
    ).rejects.toMatchObject({ code: "meta_scope_missing" });
  });
});

describe("connecting an Instagram account", () => {
  const igRoutes = (me: unknown) => ({
    "api.instagram.com/oauth/access_token": {
      body: {
        access_token: "IGSHORT",
        user_id: "17841400000",
        permissions: ["instagram_business_basic"],
      },
    },
    "graph.instagram.com/access_token?": {
      body: {
        access_token: "IGLONG",
        token_type: "bearer",
        expires_in: 5183944,
      },
    },
    "/me?fields=": { body: me },
  });

  it("stores a self-refreshing 60-day token", async () => {
    const { http, calls } = transport(
      igRoutes({ user_id: "17841400000", username: "natgeo", name: "Nat Geo" }),
    );
    const before = Date.now();
    const out = await connectInstagramAccount("ig-code", config, http);
    expect(out.external_channel).toBe("17841400000");
    expect(out.handle).toBe("@natgeo");
    expect(out.title).toBe("Nat Geo");
    expect(out.tokens).toMatchObject({
      access_token: "IGLONG",
      refresh_token: "IGLONG",
      provider: "instagram",
    });
    const ttl = Date.parse(out.tokens.expires_at) - before;
    expect(ttl).toBeGreaterThan(5183944_000 - 60_000);
    expect(ttl).toBeLessThan(5183944_000 + 60_000);
    expect(out.scopes).toEqual([
      "instagram_business_basic",
      "instagram_business_manage_comments",
    ]);
    // The first exchange is a form POST with the Instagram app's own credentials.
    expect(calls[0].init.method).toBe("POST");
    expect(String(calls[0].init.body)).toContain("client_id=9876543210");
    expect(String(calls[0].init.body)).toContain(
      "client_secret=not-a-real-ig-secret",
    );
    expect(String(calls[0].init.body)).toContain(
      "grant_type=authorization_code",
    );
    expect(calls[1].url).toContain("grant_type=ig_exchange_token");
    expect(calls[1].url).toContain("access_token=IGSHORT");
    expect(calls[2].url).toContain(
      "https://graph.instagram.com/v25.0/me?fields=user_id,username,name",
    );
  });

  it("an account without a professional user id is not connectable", async () => {
    const { http } = transport(igRoutes({ username: "someone" }));
    await expect(
      connectInstagramAccount("c", config, http),
    ).rejects.toMatchObject({ code: "instagram_not_professional" });
  });

  it("refreshes a token, and turns 190 into a revocation", async () => {
    const ok = transport({
      refresh_access_token: {
        body: {
          access_token: "IGNEW",
          token_type: "bearer",
          expires_in: 5184000,
        },
      },
    });
    const renewed = await refreshInstagramToken("IGOLD", ok.http);
    expect(renewed.access_token).toBe("IGNEW");
    expect(renewed.refresh_token).toBe("IGNEW");
    expect(ok.calls[0].url).toContain("grant_type=ig_refresh_token");
    expect(ok.calls[0].url).toContain("access_token=IGOLD");
    const dead = transport({
      refresh_access_token: {
        status: 400,
        body: { error: { code: 190, message: "x" } },
      },
    });
    await expect(
      refreshInstagramToken("IGOLD", dead.http),
    ).rejects.toBeInstanceOf(RevokedError);
    const flaky = transport({
      refresh_access_token: { status: 500, body: {} },
    });
    await expect(
      refreshInstagramToken("IGOLD", flaky.http),
    ).rejects.toMatchObject({ code: "token_refresh_failed" });
  });
});

describe("when a stored grant is renewed", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const at = (ms: number) => new Date(now + ms).toISOString();
  const DAY = 24 * 3600_000;

  it("renews an Instagram token a week before its sixty days end, not in its last minutes", () => {
    // Google's 15-minute margin fits a one-hour token; on a 60-day token the
    // hourly claim would almost never land inside it and the token would lapse.
    expect(renewalDue("instagram", at(3 * DAY), now)).toBe(true);
    expect(renewalDue("instagram", at(30 * DAY), now)).toBe(false);
    expect(renewalDue("google", at(3 * DAY), now)).toBe(false);
    expect(renewalDue("google", at(10 * 60_000), now)).toBe(true);
    // A page token does not expire and has nothing to renew with.
    expect(renewalDue("facebook", at(10 * 60_000), now)).toBe(false);
    // A seal from before the Meta doors is Google's.
    expect(renewalDue(undefined, at(10 * 60_000), now)).toBe(true);
  });
});
