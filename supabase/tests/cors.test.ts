import { describe, expect, it } from "vitest";
import {
  corsHeaders,
  parseOrigins,
  preflight,
} from "../functions/_shared/cors";

const ALLOWED = parseOrigins(
  " https://app.sky-develop.net , http://127.0.0.1:5173 ,, ",
);
const from = (origin: string | null, method = "POST") =>
  new Request("https://x.invalid/oauth-start", {
    method,
    ...(origin ? { headers: { origin } } : {}),
  });

describe("cross-origin permission", () => {
  it("answers the preflight the browser sends before the real request", () => {
    // Without this the browser refuses to send at all, and the app sees a
    // network failure with nothing behind it. Every curl test passed the whole
    // time, because curl does not enforce CORS.
    const response = preflight(
      from("https://app.sky-develop.net", "OPTIONS"),
      ALLOWED,
    )!;
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.sky-develop.net",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "x-client-info",
    );
    expect(preflight(from("https://app.sky-develop.net"), ALLOWED)).toBeNull();

    // When the browser asks for specific headers via access-control-request-headers
    const preflightWithReqHeaders = preflight(
      new Request("https://x.invalid/channel-lookup", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.sky-develop.net",
          "access-control-request-headers":
            "authorization, content-type, apikey, x-client-info",
        },
      }),
      ALLOWED,
    )!;
    expect(
      preflightWithReqHeaders.headers.get("access-control-allow-headers"),
    ).toBe("authorization, content-type, apikey, x-client-info");
  });

  it("gives permission to our origins and to no others", () => {
    // These functions are reached with a user's access token in a header, so a
    // permissive origin would let any page on the internet start a connection
    // with a token it had obtained.
    for (const ok of ["https://app.sky-develop.net", "http://127.0.0.1:5173"])
      expect(
        corsHeaders(from(ok), ALLOWED)["access-control-allow-origin"],
      ).toBe(ok);
    for (const no of [
      "https://evil.example",
      "https://app.sky-develop.net.evil.example",
      "http://app.sky-develop.net",
      null,
    ])
      expect(corsHeaders(from(no), ALLOWED)).toEqual({});
  });

  it("varies on origin, so a cache cannot serve one origin's answer to another", () => {
    expect(corsHeaders(from("https://app.sky-develop.net"), ALLOWED).vary).toBe(
      "Origin",
    );
  });

  it("treats an unset allowlist as permitting nobody", () => {
    // A misconfigured deploy should refuse every origin rather than allow every
    // origin, which is the direction that fails safely.
    expect(parseOrigins(undefined)).toEqual([]);
    expect(corsHeaders(from("https://app.sky-develop.net"), [])).toEqual({});
  });
});
