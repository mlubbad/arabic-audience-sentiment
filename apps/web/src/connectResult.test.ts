// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "./strings/ar";
import { completePendingConnection, connectResult } from "./connectResult";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({ supabase: { auth: { getSession } } }));

const at = (q: string) => connectResult(new URLSearchParams(q), ar);

describe("coming back from Google", () => {
  beforeEach(() => {
    sessionStorage.clear();
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt" } },
    });
    vi.restoreAllMocks();
  });

  it("shows a safe in-flight state while OAuth completion is pending", () => {
    const pending = at("connect=pending&ticket=ticket");
    expect(pending.tone).toBe("notice");
    expect(pending.detail).toContain("نتحقق");
  });

  it("posts the browser nonce once, clears it, and maps the attached channel", async () => {
    sessionStorage.setItem("oauth_browser_nonce", "browser-nonce");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ channel_id: "channel-id" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const completion = await completePendingConnection("ticket");
    expect(completion).toEqual({ kind: "success", channelId: "channel-id" });
    expect(sessionStorage.getItem("oauth_browser_nonce")).toBeNull();
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      ticket: "ticket",
      nonce: "browser-nonce",
    });
    expect(
      connectResult(
        new URLSearchParams("connect=pending&ticket=ticket"),
        ar,
        completion,
      ).tone,
    ).toBe("success");

    const replay = await completePendingConnection("ticket");
    expect(replay).toEqual({
      kind: "error",
      code: "oauth_binding_mismatch",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses the binding fallback for a blank code and preserves a real code", async () => {
    for (const [code, expected] of [
      ["  ", "oauth_binding_mismatch"],
      ["quota_exceeded", "quota_exceeded"],
    ]) {
      sessionStorage.setItem("oauth_browser_nonce", "browser-nonce");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ code }), {
              status: 409,
            }),
        ),
      );
      await expect(completePendingConnection("ticket")).resolves.toEqual({
        kind: "error",
        code: expected,
      });
    }
  });

  it("says what to do about a project that has the API switched off", () => {
    // The failure this was written for. "channel_lookup_failed" told the person
    // nothing; the fix is not a prettier sentence but naming the one thing
    // standing in the way.
    const r = at("status=error&code=youtube_api_not_enabled");
    expect(r.detail).toContain("YouTube Data API");
    expect(r.action).toBe("console");
    expect(r.tone).toBe("error");
  });

  it("treats declining as a choice, not a failure", () => {
    const r = at("status=error&code=declined");
    expect(r.tone).toBe("notice");
    expect(r.detail).toContain("لم يُربط شيء");
    expect(r.action).toBe("retry");
  });

  it("tells apart the ways a Google account can be the wrong one", () => {
    // No channel, several channels, and a partial grant are three different
    // situations with three different next steps.
    const detail = (c: string) => at(`status=error&code=${c}`).detail;
    const all = [
      detail("no_channel_on_account"),
      detail("ambiguous_channel"),
      detail("no_refresh_token"),
    ];
    expect(new Set(all).size).toBe(3);
    expect(all[1]).toContain("أكثر من قناة");
  });

  it("explains a spent state rather than calling it a bug", () => {
    // Single use is deliberate; the message says so, because otherwise it
    // reads as the product losing track of a request.
    expect(at("status=error&code=invalid_state").detail).toContain(
      "إعادة استخدام",
    );
  });

  it("names the four Meta refusals in the reader's language", () => {
    expect(at("status=error&code=meta_no_page")).toMatchObject({
      tone: "error",
      detail: ar.crMetaNoPage,
      action: "retry",
    });
    expect(at("status=error&code=meta_scope_missing").detail).toBe(
      ar.crMetaScopeMissing,
    );
    expect(at("status=error&code=instagram_not_professional").detail).toBe(
      ar.crInstagramNotProfessional,
    );
    expect(at("status=error&code=meta_token_exchange_failed").detail).toBe(
      ar.crMetaTokenExchangeFailed,
    );
  });

  it("shows an unknown code as a code, never as server text", () => {
    const r = at("status=error&code=some_new_failure");
    expect(r.detail).toContain("some_new_failure");
    expect(r.action).toBe("retry");
    expect(at("status=error").detail).toContain("unknown");
  });

  it("confirms a connection and names the channel when it has one", () => {
    const r = at("status=connected&channel=UCabc");
    expect(r.tone).toBe("success");
    expect(r.detail).toContain("UCabc");
    expect(at("status=connected").detail).not.toContain("undefined");
  });
});
