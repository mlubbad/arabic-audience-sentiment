/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the fixture `data.ts` reads on `/dashboard` without a live
   *  session. Unset in normal dev/build (the visitor's demo fixture);
   *  `playwright.config.ts` points it at the e2e kernel for the browser suite. */
  readonly VITE_FIXTURE_DASHBOARD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
