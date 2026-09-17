import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** `vite preview` answers a public address the way the host does.
 *
 *  Vite's preview server probes no extensions and falls back to `index.html`,
 *  so `/pricing` got the prerendered *landing* — the SPA fallback — and not
 *  `pricing/index.html`; only `/pricing/` found the file, and no canonical
 *  address here carries a slash. A browser test against the preview was
 *  therefore reading the landing's markup whichever page it asked for, with
 *  JavaScript off, and passing. These are `public/.htaccess`'s two rewrite
 *  rules: a directory with a prerendered `index.html` is served for its
 *  address with or without the slash, and anything that is not a file gets
 *  `app.html` — the empty template the shell renders from — not the landing.
 *  Preview only: `vite dev` has no prerendered pages to serve, and the build
 *  is untouched. */
function prerenderedPages(): Plugin {
  return {
    name: "prerendered-pages",
    configurePreviewServer(server) {
      const dist = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "/";
        const q = url.indexOf("?");
        const path = q === -1 ? url : url.slice(0, q);
        const query = q === -1 ? "" : url.slice(q);
        const bare = path.replace(/\/+$/, "");
        if (bare && existsSync(join(dist, bare, "index.html")))
          req.url = `${bare}/index.html${query}`;
        else if (bare && !existsSync(join(dist, path)))
          req.url = `/app.html${query}`;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), prerenderedPages()],
  // Where .env files are read from. The browser suite points this at a
  // directory holding none, so the app under test is configured by the suite
  // and not by whatever .env.local the developer happens to have. Without it a
  // configured Supabase project silently changes what the app renders, and a
  // test asserting the unconfigured notice fails on one machine and passes on
  // another — which is worse than failing everywhere.
  envDir: process.env.VITE_ENV_DIR || undefined,
  build: {
    // Not `assets`, and not a matter of taste. The preview host sits behind a
    // CDN this project has no purge credential for, and on 2026-09-15 every
    // URL under `assets/` was pinned at the edge to a `401` marked
    // `immutable` — a year-long cache entry that no request could dislodge,
    // because a content hash only changes when the content does. The bug that
    // caused it is fixed in public/.htaccess; this rename is how the build
    // that was already poisoned got a set of addresses that were not.
    //
    // It must stay in step with the sweep in scripts/deploy-preview.sh, which
    // deletes the previous build's files from this directory by name.
    assetsDir: "static",
  },
  server: { host: "127.0.0.1", strictPort: true, port: 5173 },
});
