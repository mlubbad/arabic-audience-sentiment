import { describe, expect, it } from "vitest";
import { ar } from "../strings/ar";
import { en } from "../strings/en";
import { lookupCode, lookupErrorMessage } from "./channelLookupError";

const httpError = (status: number, body: unknown) => ({
  name: "FunctionsHttpError",
  context: new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status },
  ),
});

describe("lookupCode", () => {
  it("reads the function's own code from the body", async () => {
    expect(
      await lookupCode(httpError(502, { code: "reader_token_lapsed" })),
    ).toBe("reader_token_lapsed");
  });

  it("falls back to the HTTP status when the body has no code", async () => {
    expect(await lookupCode(httpError(401, { msg: "Invalid JWT" }))).toBe(
      "http_401",
    );
    expect(await lookupCode(httpError(500, "not json"))).toBe("http_500");
  });

  it("names the client error when the function was never reached", async () => {
    expect(
      await lookupCode({ name: "FunctionsFetchError", message: "x" }),
    ).toBe("FunctionsFetchError");
  });

  it("returns nothing for an anonymous failure", async () => {
    expect(await lookupCode(new Error("boom"))).toBe("");
    expect(await lookupCode(null)).toBe("");
  });
});

describe("lookupErrorMessage", () => {
  it("keeps the dedicated sentences", () => {
    expect(lookupErrorMessage("quota_exceeded", ar)).toBe(ar.addChannelQuota);
    expect(lookupErrorMessage("channel_not_found", ar)).toBe(
      ar.channelNotFoundOnPlatform,
    );
    expect(lookupErrorMessage("lookup_not_configured", ar)).toBe(
      ar.addChannelNotConfigured,
    );
    expect(lookupErrorMessage("invalid_query", ar)).toBe(
      ar.addChannelQueryInvalid,
    );
  });

  it("shows the code in every other failure", () => {
    for (const code of [
      "reader_token_lapsed",
      "source_access_denied:quotaExceeded",
      "http_401",
      "FunctionsFetchError",
    ]) {
      const ar1 = lookupErrorMessage(code, ar);
      const en1 = lookupErrorMessage(code, en);
      expect(ar1).toContain(code);
      expect(en1).toContain(code);
      expect(ar1).not.toBe(ar.addChannelFailed);
    }
  });

  it("isolates the code inside the Arabic sentence", () => {
    const [fsi, pdi] = [0x2068, 0x2069].map((c) => String.fromCodePoint(c));
    expect(lookupErrorMessage("http_401", ar)).toContain(
      `${fsi}http_401${pdi}`,
    );
  });

  it("does not echo an empty or foreign code", () => {
    expect(lookupErrorMessage("", ar)).toBe(ar.addChannelFailed);
    expect(lookupErrorMessage("<script>x</script>", ar)).toBe(
      ar.addChannelFailed,
    );
    expect(lookupErrorMessage("a".repeat(65), en)).toBe(en.addChannelFailed);
  });
});
