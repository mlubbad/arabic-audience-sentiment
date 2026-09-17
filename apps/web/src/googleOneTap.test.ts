// @vitest-environment jsdom
import { createElement } from "react";
import { render, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GSI_SRC, nonce, useGoogleOneTap } from "./googleOneTap";

async function sha256hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Exercises the hook the way `Account.tsx` will: called unconditionally,
 *  with `enabled`/`clientId` carrying the actual gate. */
function Probe(props: {
  enabled: boolean;
  clientId: string | undefined;
  onCredential: (credential: string, rawNonce: string) => void;
}) {
  useGoogleOneTap(props);
  return null;
}

function scriptTags(): HTMLScriptElement[] {
  return [
    ...document.querySelectorAll<HTMLScriptElement>(`script[src="${GSI_SRC}"]`),
  ];
}

beforeEach(() => {
  document.head.innerHTML = "";
  delete window.google;
});

afterEach(() => {
  cleanup();
});

describe("nonce", () => {
  it("produces a raw base64url value and its own SHA-256 hex hash", async () => {
    const n = await nonce();
    expect(n.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(n.hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(n.hashed).toBe(await sha256hex(n.raw));
  });
});

describe("useGoogleOneTap", () => {
  it("initializes and prompts once GSI is already on the page, then hands the raw nonce back through onCredential", async () => {
    const initialize = vi.fn();
    const prompt = vi.fn();
    const cancel = vi.fn();
    window.google = { accounts: { id: { initialize, prompt, cancel } } };

    const onCredential = vi.fn();
    const { unmount } = render(
      createElement(Probe, {
        enabled: true,
        clientId: "cid",
        onCredential,
      }),
    );

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "cid",
        use_fedcm_for_prompt: true,
        nonce: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(prompt).toHaveBeenCalledTimes(1);

    const passedNonce = initialize.mock.calls[0][0].nonce as string;
    const callback = initialize.mock.calls[0][0].callback as (r: {
      credential?: string;
    }) => void;
    callback({ credential: "tok" });

    expect(onCredential).toHaveBeenCalledTimes(1);
    const [credential, rawNonce] = onCredential.mock.calls[0];
    expect(credential).toBe("tok");
    expect(await sha256hex(rawNonce as string)).toBe(passedNonce);

    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("injects exactly one GSI script tag across two hook instances when it is not already loaded", async () => {
    const onCredential = vi.fn();
    render(
      createElement(
        "div",
        null,
        createElement(Probe, { enabled: true, clientId: "cid", onCredential }),
        createElement(Probe, {
          enabled: true,
          clientId: "cid-2",
          onCredential,
        }),
      ),
    );

    await waitFor(() => expect(scriptTags().length).toBeGreaterThan(0));
    expect(scriptTags()).toHaveLength(1);
    const tag = scriptTags()[0];
    expect(tag.async).toBe(true);
    expect(tag.defer).toBe(true);
  });

  it("retries after a failed script load, rather than caching the rejection forever", async () => {
    // A module-fresh copy of the hook: the previous test's script tag never
    // fires `load` or `error`, so this file's shared `loading` promise is
    // left permanently pending in that module instance — reusing it here
    // would make this test hang rather than exercise a real load. A fresh
    // import gets its own `loading`, starting at `null`, the same way a
    // separate page load would.
    vi.resetModules();
    const fresh = await import("./googleOneTap");
    function FreshProbe(props: {
      enabled: boolean;
      clientId: string | undefined;
      onCredential: (credential: string, rawNonce: string) => void;
    }) {
      fresh.useGoogleOneTap(props);
      return null;
    }

    const onCredential = vi.fn();
    const { unmount } = render(
      createElement(FreshProbe, {
        enabled: true,
        clientId: "cid",
        onCredential,
      }),
    );

    await waitFor(() => expect(scriptTags()).toHaveLength(1));
    const failedTag = scriptTags()[0];
    failedTag.dispatchEvent(new Event("error"));
    // The onerror handler removes the tag itself; wait for that (and the
    // hook's own `.catch`) to settle before moving on.
    await waitFor(() => expect(scriptTags()).toHaveLength(0));
    unmount();

    render(
      createElement(FreshProbe, {
        enabled: true,
        clientId: "cid-2",
        onCredential,
      }),
    );
    // A cached, forever-rejected `loading` promise would never call
    // `loadGsi` again, so no new tag would appear here.
    await waitFor(() => expect(scriptTags()).toHaveLength(1));
    expect(scriptTags()[0]).not.toBe(failedTag);
  });

  it("does nothing when disabled", async () => {
    const onCredential = vi.fn();
    render(
      createElement(Probe, { enabled: false, clientId: "cid", onCredential }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(scriptTags()).toHaveLength(0);
    expect(onCredential).not.toHaveBeenCalled();
  });

  it("does nothing without a client id", async () => {
    const onCredential = vi.fn();
    render(
      createElement(Probe, {
        enabled: true,
        clientId: undefined,
        onCredential,
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(scriptTags()).toHaveLength(0);
    expect(onCredential).not.toHaveBeenCalled();
  });
});
