/**
 * Google One Tap on the account page.
 *
 * Google Identity Services is a `<script>`, not a package: it is loaded once,
 * lazily, only when a door is actually open, and the loader is shared across
 * every hook instance so two mounts never inject it twice. The nonce is the
 * seam with Supabase — `signInWithIdToken` is handed the raw value and Google
 * is handed only its SHA-256 hash, the same split `oauth-start.ts` uses for
 * PKCE, so the credential Google returns cannot be replayed with a different
 * nonce than the one this browser actually asked for.
 */
import { useEffect, useRef } from "react";

export const GSI_SRC = "https://accounts.google.com/gsi/client";

/** base64url, unpadded — the same encoding `oauth-start.ts` uses for PKCE. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** `raw` goes to Supabase with the credential; `hashed` is what Google signs
 *  into the ID token, so the two must be verified together, never separately. */
export async function nonce(): Promise<{ raw: string; hashed: string }> {
  const raw = base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { raw, hashed: await sha256Hex(raw) };
}

// Shared across every hook instance so a second mount (or a second call
// before the first resolves) never injects the script twice.
let loading: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (!loading)
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        // A failed load must not be cached forever in the shared `loading`
        // promise, or every later mount — a route revisit, a retry — would
        // replay the same rejection until the page is reloaded. Clearing it
        // and dropping the dead tag lets the next call to `loadGsi` start a
        // fresh attempt with a fresh script element.
        loading = null;
        script.remove();
        reject(new Error("gsi_load_failed"));
      };
      document.head.appendChild(script);
    });
  return loading;
}

/**
 * Prompts Google One Tap for a signed-out visitor when a door is actually
 * open. Called unconditionally at the top of `Account.tsx`, with `enabled`
 * carrying the gate — hooks cannot themselves be conditional.
 */
export function useGoogleOneTap(opts: {
  enabled: boolean;
  clientId: string | undefined;
  onCredential: (credential: string, rawNonce: string) => void | Promise<void>;
}): void {
  const { enabled, clientId } = opts;
  // Kept in a ref so the effect below only depends on what actually changes
  // the prompt — re-running it on every render would re-prompt on every
  // keystroke elsewhere on the page.
  const onCredentialRef = useRef(opts.onCredential);
  onCredentialRef.current = opts.onCredential;

  useEffect(() => {
    if (!enabled || !clientId) return;
    let cancelled = false;
    void (async () => {
      const n = await nonce();
      await (window.google ? Promise.resolve() : loadGsi()).catch(() => null);
      if (cancelled || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (r) => {
          if (r.credential) void onCredentialRef.current(r.credential, n.raw);
        },
        nonce: n.hashed,
        use_fedcm_for_prompt: true,
        cancel_on_tap_outside: false,
        itp_support: true,
      });
      window.google.accounts.id.prompt();
    })();
    return () => {
      cancelled = true;
      window.google?.accounts.id.cancel();
    };
  }, [enabled, clientId]);
}
