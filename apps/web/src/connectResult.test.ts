import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { connectResult } from "./connectResult";

const at = (q: string) => connectResult(new URLSearchParams(q), ar);

describe("coming back from Google", () => {
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
