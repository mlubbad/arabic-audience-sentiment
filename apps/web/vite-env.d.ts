/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the fixture `data.ts` reads on `/dashboard` without a live
   *  session. Unset in normal dev/build (the visitor's demo fixture);
   *  `playwright.config.ts` points it at the e2e kernel for the browser suite. */
  readonly VITE_FIXTURE_DASHBOARD?: string;
  /** Which sign-in doors are open (comma-separated: google, azure, sso).
   *  See `authProviders.ts`. */
  readonly VITE_AUTH_PROVIDERS?: string;
  /** The Google OAuth client's id, public by design — the secret lives only
   *  in the Supabase project. Drives Google One Tap on the account page. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
