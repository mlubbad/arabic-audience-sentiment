# Sign in with Google, and Google One Tap (design)

2026-09-17. Requested by the operator; the console side is done: the OAuth client
`272573239614-31idkf1nk8hegpceqt3pdmbeefnsaqsr.apps.googleusercontent.com` (the same client
the YouTube channel-connect uses, Google Cloud project 272573239614) carries the Supabase
callback `https://ykqugctewsqvevhyqtbi.supabase.co/auth/v1/callback` and the site origins;
Supabase Auth's Google provider is enabled with that client, its id listed under
"Authorized Client IDs" (what `signInWithIdToken` verifies against); Site URL and redirect
URLs point at `https://app.sky-develop.net/account` and the local dev origins.

## What exists

`apps/web/src/authProviders.ts` renders the three doors (Google, Microsoft, SSO) and opens
only those named in `VITE_AUTH_PROVIDERS`; a closed door says why. `Account.tsx`'s
`startProvider` already calls `supabase.auth.signInWithOAuth({ provider, options: {
redirectTo: origin + "/account" } })`. So **Sign in with Google is a configuration change**:
`VITE_AUTH_PROVIDERS=google` in the build's env opens the door the UI already has.

**One Tap** does not exist. It is Google Identity Services (GIS) showing the account chooser
in the page's corner; its result is an ID token, which Supabase accepts through
`auth.signInWithIdToken({ provider: "google", token, nonce })`.

## Approach

- **Configuration:** `.env.example` documents `VITE_AUTH_PROVIDERS=google` and
  `VITE_GOOGLE_CLIENT_ID=`; `apps/web/.env.local` (gitignored, the file the live build reads)
  sets both. The client id is public by nature (it ships in HTML); the secret never leaves
  Supabase.
- **`apps/web/src/googleOneTap.ts`:** `useGoogleOneTap({ enabled, clientId, onCredential })`.
  When `enabled` (Google is an open provider AND a client id is set AND there is no
  session AND the page is `/account`), it injects `https://accounts.google.com/gsi/client`
  once (`async defer`), and on load calls `google.accounts.id.initialize({ client_id,
  callback, nonce: <sha256 hex of a random nonce>, use_fedcm_for_prompt: true,
  cancel_on_tap_outside: false, itp_support: true })` then `google.accounts.id.prompt()`.
  The callback hands `(credential, rawNonce)` to `onCredential`, which calls
  `supabase.auth.signInWithIdToken({ provider: "google", token: credential, nonce: rawNonce })`
  — Google receives the hashed nonce, Supabase the raw one, and verifies the token's `nonce`
  claim is its hash (Supabase's documented pattern). On error the page says
  `S.providerStartFailed`, the sentence the OAuth door already uses.
  `nonce()` (random 32 bytes → base64url; hash via `crypto.subtle.digest("SHA-256")`) is its
  own exported helper so it is testable. Cleanup on unmount: `google.accounts.id.cancel()`.
  The hook never runs when `window.google` is absent (script blocked) — the OAuth button
  remains the way in; One Tap is an addition, never a dependency.
- **Where:** the account page's signed-out screen only — not the landing, not the
  dashboard's fixture view. A visitor reading the marketing page is not asked to sign in;
  a visitor who came to the account page is.
- **Types:** a minimal `google.accounts.id` declaration in `apps/web/src/google-gsi.d.ts`
  (no dependency added).
- **Strings:** none new (the GIS prompt is Google's own UI; the failure sentence exists).

## Testing

- `googleOneTap.test.ts` (jsdom): `nonce()` returns a raw value and a 64-hex hash equal to
  WebCrypto's SHA-256 of the raw; the hook injects the script once (two renders, one tag);
  with a fake `window.google`, `initialize` is called with the client id and the HASHED
  nonce and `prompt` is called; invoking the captured `callback({ credential: "t" })` calls
  `onCredential("t", rawNonce)`; `enabled: false` → no script, no calls; unmount → `cancel`.
- `authProviders.test.ts` already proves `google` opens the door; `Account.entry.test.ts`
  gains one case: with providers `"google"` the Google button carries no closed reason.
- No e2e (Google cannot be driven headlessly); the live check is the operator's, on
  `https://app.sky-develop.net/account`: the OAuth button signs in; One Tap appears for a
  signed-out visitor with a Google session in the browser.

## Out of scope

Microsoft/SSO doors; account linking rules beyond Supabase's default (same email → same
user when the provider reports the email verified); the sign-in screen's redesign
(phase 5); a GIS-rendered button (the existing door suffices).
