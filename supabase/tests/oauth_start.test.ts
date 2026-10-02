/**
 * The authorization redirect: PKCE, the state, and the URL.
 *
 * The token exchange needs Google credentials and is not written. Everything up
 * to the redirect does not, and is checked here against the RFC's own vector.
 */
import { describe, expect, it } from "vitest";
import {
  base64url,
  beginAuthorization,
  codeChallenge,
  isSafeRedirect,
  sha256Hex,
  type OauthConfig,
  type StartDb,
} from "../functions/_shared/oauth-start";

const config: OauthConfig = {
  client_id: "1234.apps.googleusercontent.com",
  redirect_uri: "https://app.example/oauth/youtube/callback",
  scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
};
const W = "00000000-0000-4000-8000-000000000001";
const C = "00000000-0000-4000-8000-0000000000c1";

// A predictable source that advances between calls, as a real one does. A stub
// returning the same block twice makes the verifier and the state identical,
// which is not a case any CSPRNG produces and would mask the assertion below.
const sequential = (start: number) => {
  let call = 0;
  return (n: number) =>
    Uint8Array.from(
      { length: n },
      (_, i) => (start + call * 97 + i) % 256,
      call++,
    );
};

function recorder() {
  const calls: unknown[][] = [];
  const db: StartDb = {
    createState: async (...args) => {
      calls.push(args);
    },
  };
  return { db, calls };
}

describe("pkce", () => {
  it("matches the worked example in RFC 7636", async () => {
    // Appendix B. If this drifts, Google rejects every exchange with
    // invalid_grant and the cause is not obvious from the error.
    expect(
      await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("produces only unreserved characters, at the length the RFC requires", async () => {
    // base64url without padding is exactly the unreserved set, so the value
    // never needs escaping and the database check cannot reject our own output.
    const v = base64url(sequential(0)(32));
    expect(v).toHaveLength(43);
    expect(v).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(await codeChallenge(v)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("the authorization redirect", () => {
  it("asks for a code with S256, and never puts the verifier in the URL", async () => {
    const { db, calls } = recorder();
    const { url, state } = await beginAuthorization(
      W,
      C,
      config,
      db,
      sequential(1),
    );
    const q = new URL(url).searchParams;

    expect(new URL(url).origin + new URL(url).pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(q.get("response_type")).toBe("code");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("client_id")).toBe(config.client_id);
    expect(q.get("redirect_uri")).toBe(config.redirect_uri);
    expect(q.get("scope")).toBe(config.scopes.join(" "));
    // A refresh token, and the consent that makes Google actually return one.
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");

    const [, , , verifier] = calls[0] as string[];
    // The one thing that must never travel through the browser.
    expect(url).not.toContain(verifier);
    // Independent values: reusing one for both would publish the verifier as
    // the state and defeat PKCE entirely.
    expect(verifier).not.toBe(state);
    expect(q.get("code_challenge")).toBe(await codeChallenge(verifier));
    expect(q.get("code_challenge")).not.toBe(verifier);
  });

  it("stores the state as a hash and sends the state itself", async () => {
    const { db, calls } = recorder();
    const { url, state } = await beginAuthorization(
      W,
      C,
      config,
      db,
      sequential(7),
    );
    const [workspace, client, stored] = calls[0] as string[];
    expect([workspace, client]).toEqual([W, C]);
    // The browser carries the state back, so a readable copy in the database
    // would be enough to forge a callback.
    expect(stored).toBe(await sha256Hex(state));
    expect(stored).not.toBe(state);
    expect(new URL(url).searchParams.get("state")).toBe(state);
  });

  it("returns a browser nonce but stores only its hash outside the Google URL", async () => {
    const { db, calls } = recorder();
    const { url, nonce } = await beginAuthorization(
      W,
      C,
      config,
      db,
      sequential(11),
    );
    const storedNonce = (calls[0] as string[])[4];
    expect(nonce).toHaveLength(43);
    expect(storedNonce).toBe(await sha256Hex(nonce));
    expect(url).not.toContain(nonce);
  });

  it("records the state before handing out the URL", async () => {
    // A callback for a state that was never recorded is refused, so the write
    // must not be able to fail after the user has already been sent to Google.
    const db: StartDb = {
      createState: async () => {
        throw new Error("forbidden");
      },
    };
    await expect(
      beginAuthorization(W, C, config, db, sequential(1)),
    ).rejects.toThrow("forbidden");
  });

  it("gives every attempt its own verifier and state", async () => {
    const { db, calls } = recorder();
    const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    const a = await beginAuthorization(W, C, config, db, random);
    const b = await beginAuthorization(W, C, config, db, random);
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect((calls[0] as string[])[3]).not.toBe((calls[1] as string[])[3]);
  });

  it("accepts http only on the loopback interface", async () => {
    // Google documents the loopback exception and development needs it: a code
    // delivered to 127.0.0.1 never traverses a network. Everything else on
    // http would put the authorization code on the wire in clear.
    for (const ok of [
      "https://app.example/callback",
      "http://127.0.0.1:5173/oauth/youtube/callback",
      "http://localhost:5173/callback",
      "http://[::1]:5173/callback",
    ])
      expect(isSafeRedirect(ok)).toBe(true);

    for (const bad of [
      "http://app.example/callback",
      // A substring test for "127.0.0.1" would accept both of these.
      "http://127.0.0.1.evil.test/callback",
      "http://evil.test/?next=http://127.0.0.1",
      "http://localhost.evil.test/callback",
      "ftp://127.0.0.1/callback",
      "not a url",
      "",
    ])
      expect(isSafeRedirect(bad)).toBe(false);
  });

  it("refuses to build a redirect from incomplete or insecure configuration", async () => {
    const { db, calls } = recorder();
    for (const bad of [
      { ...config, client_id: "" },
      { ...config, redirect_uri: "" },
      { ...config, scopes: [] },
      // http off the loopback interface would put the code on the wire.
      { ...config, redirect_uri: "http://app.example/callback" },
    ]) {
      await expect(
        beginAuthorization(W, C, bad, db, sequential(1)),
      ).rejects.toThrow("oauth_not_configured");
    }
    // Nothing was written for a request that could never have been completed.
    expect(calls).toHaveLength(0);
  });
});
