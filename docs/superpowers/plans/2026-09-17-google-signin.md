# Google Sign-in and One Tap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the Google door by configuration and add Google One Tap on the signed-out account page through Google Identity Services + `supabase.auth.signInWithIdToken` with a hashed nonce.

**Architecture:** One hook (`googleOneTap.ts`) owns script injection, nonce, `initialize`/`prompt`/`cancel`; `Account.tsx` calls it only on its signed-out screen and hands the credential to Supabase; env vars gate everything.

**Tech Stack:** React 19, `@supabase/supabase-js` (`signInWithIdToken`), Google Identity Services (script, no package), WebCrypto, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-09-17-google-signin-design.md`

## Global Constraints

- The client secret never appears anywhere in the repo or the browser. The client id (`272573239614-31idkf1nk8hegpceqt3pdmbeefnsaqsr.apps.googleusercontent.com`) is public and lives in env (`VITE_GOOGLE_CLIENT_ID`), never hard-coded in source.
- One Tap only on `/account` while signed out; never on the landing or the dashboard.
- No new strings; failures use `S.providerStartFailed`.
- Google gets the SHA-256 hex of the nonce; Supabase gets the raw nonce.
- Other session's files untouched; stage by exact path; no push (the controller pushes). Docs append-only. Commit messages are sentences ending `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: `googleOneTap.ts` + types + tests

**Files:** Create `apps/web/src/googleOneTap.ts`, `apps/web/src/googleOneTap.test.ts`, `apps/web/src/google-gsi.d.ts`; modify `apps/web/vite-env.d.ts` (declare `VITE_GOOGLE_CLIENT_ID?: string`, `VITE_AUTH_PROVIDERS?: string` if absent).

**Interfaces:**
```ts
export async function nonce(): Promise<{ raw: string; hashed: string }>; // raw: base64url of 32 random bytes; hashed: sha256 hex of raw (UTF-8)
export const GSI_SRC = "https://accounts.google.com/gsi/client";
export function useGoogleOneTap(opts: {
  enabled: boolean; clientId: string | undefined;
  onCredential: (credential: string, rawNonce: string) => void | Promise<void>;
}): void;
```
- [ ] **Step 1: failing test** `googleOneTap.test.ts` (`// @vitest-environment jsdom`):
  - `nonce()`: `raw` matches `/^[A-Za-z0-9_-]{43}$/`, `hashed` matches `/^[0-9a-f]{64}$/` and equals `crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))` hex.
  - render a probe component calling the hook with `enabled: true, clientId: "cid"` and a fake `window.google = { accounts: { id: { initialize: vi.fn(), prompt: vi.fn(), cancel: vi.fn() } } }` set BEFORE render (so the hook takes the "already loaded" path) → after `await waitFor`, `initialize` called once with `expect.objectContaining({ client_id: "cid", use_fedcm_for_prompt: true })` and a `nonce` of 64 hex; `prompt` called once; capture `callback` from the `initialize` arg, call it with `{ credential: "tok" }` → `onCredential` called with `("tok", raw)` where `sha256hex(raw) === nonce passed`. Unmount → `cancel` called.
  - without `window.google`: rendering injects exactly one `<script src=GSI_SRC async defer>` even across two renders/two hook instances; `enabled: false` → no script, no calls; `clientId` undefined → no script.
- [ ] **Step 2: implement.** Script loader: a module-level `let loading: Promise<void> | null`; `loadGsi()` returns the same promise; resolves on the script's `load`, rejects on `error`. Hook: `useEffect` keyed on `[enabled, clientId]`; if not enabled or no clientId → return; `let cancelled = false`; `(async () => { const n = await nonce(); await (window.google ? Promise.resolve() : loadGsi()).catch(() => null); if (cancelled || !window.google) return; window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => { if (r.credential) void onCredential(r.credential, n.raw); }, nonce: n.hashed, use_fedcm_for_prompt: true, cancel_on_tap_outside: false, itp_support: true }); window.google.accounts.id.prompt(); })(); return () => { cancelled = true; window.google?.accounts.id.cancel(); }`. Keep `onCredential` in a ref so the effect does not re-run on every render. `google-gsi.d.ts`: `declare global { interface Window { google?: { accounts: { id: { initialize(c: { client_id: string; callback: (r: { credential?: string }) => void; nonce?: string; use_fedcm_for_prompt?: boolean; cancel_on_tap_outside?: boolean; itp_support?: boolean }): void; prompt(): void; cancel(): void } } } } } export {};`
- [ ] **Step 3:** `npx vitest run apps/web/src/googleOneTap.test.ts`, `npm run typecheck`, `npm run lint`. Commit: "Google One Tap: one hook loads Google Identity Services once, hands Google a hashed nonce and the credential back with the raw one".

### Task 2: Wire into `Account.tsx`; env; entry test

**Files:** Modify `apps/web/src/Account.tsx`, `.env.example`, `apps/web/.env.local` (gitignored — set `VITE_AUTH_PROVIDERS=google` and `VITE_GOOGLE_CLIENT_ID=272573239614-31idkf1nk8hegpceqt3pdmbeefnsaqsr.apps.googleusercontent.com`; do NOT commit this file), `apps/web/src/Account.entry.test.ts`.

- [ ] **Step 1:** In `Account.tsx`, near `authProviders`: `const googleOpen = authProviders.some((p) => p.id === "google" && !p.closedReason);` and `useGoogleOneTap({ enabled: !!supabase && !session && googleOpen, clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID, onCredential: async (token, nonce) => { const { error } = await supabase!.auth.signInWithIdToken({ provider: "google", token, nonce }); if (error) say("auth", S.providerStartFailed); } })` — hooks must be called unconditionally (top of the component, before any early return; the `!supabase` early-return screen exists — place the hook above it). The session change is picked up by `useSession` as with the OAuth door.
- [ ] **Step 2:** `.env.example`: after `VITE_SITE_PUBLIC` add
  ```
  # Which sign-in doors are open (comma-separated: google, azure, sso). Each
  # needs the matching provider enabled in the Supabase project. Empty = all closed.
  VITE_AUTH_PROVIDERS=google
  # Google One Tap on the account page. The OAuth client's id (public); the
  # secret lives only in the Supabase project.
  VITE_GOOGLE_CLIENT_ID=
  ```
  and write the two values into `apps/web/.env.local` (append; keep the file's other lines).
- [ ] **Step 3:** `Account.entry.test.ts`: one case with `shared.providers = "google"` asserting the rendered HTML contains `data-provider="google"` without the `providerClosedGoogle` sentence, and that with `shared.providers = ""` it contains that sentence. (The hook runs in an effect; the static render never calls it — fine.) Also stub `import.meta.env.VITE_GOOGLE_CLIENT_ID` via `vi.stubEnv` where needed.
- [ ] **Step 4:** `npx vitest run apps/web/src/Account.entry.test.ts apps/web/src/authProviders.test.ts apps/web/src/googleOneTap.test.ts`, typecheck, lint. Then run the dev server (`npm run dev -w @sentiment/web -- --port 5175 --strictPort`, reads `.env.local`) and open `/account` with Playwright: assert the Google button is enabled (no closed sentence), a `<script src="https://accounts.google.com/gsi/client">` is in the DOM, and no console error other than Google's own network responses; screenshot `.superpowers/sdd/2026-09-17-google-signin/shots/account-google.png`; kill the server. Commit `Account.tsx`, `.env.example`, `Account.entry.test.ts`: "The Google door opens by configuration and One Tap greets a signed-out visitor on the account page".

### Task 3: Records

- [ ] `npm run check` green. Append: `docs/progress.md` (what shipped; the env keys; the live check that is the operator's), `docs/decisions.md` (One Tap on /account only; hashed/raw nonce split; no GIS button; client id public), `docs/coordination/ACTIVE.md` (row + pending: operator verifies on the live host after deploy), `docs/deployment.md` if it lists env vars (add the two). `docs/verification.md` only if clean. Commit: "docs: Google sign-in and One Tap recorded".

## Self-review
Spec coverage: config (T2), hook (T1), account wiring (T2), tests (T1/T2), records (T3). Types consistent: `useGoogleOneTap` opts identical in T1 and T2; `nonce()` shape used by T1's test only.
