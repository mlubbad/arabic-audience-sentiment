# Private preview deployment

`app.sky-develop.net`, on the shared DirectAdmin host (`skydevelop` account, `u92286`,
origin `91.204.209.213`). Fixture-backed and password-protected.

**One of the two things keeping it out of search is not actually running.** The deploy
ships a `robots.txt` reading `User-agent: * / Disallow: /`, but Cloudflare Managed Content
serves its own in its place — 1836 bytes that disallow `GPTBot`, `Google-Extended` and
`meta-externalagent` and say nothing about anyone else. Checked by fetching the live URL:
our 26-byte file is not what comes back.

The site is still not indexable, because every path answers `401` and a crawler cannot read
what it cannot fetch. HTTP auth is the protection; the robots file was the belt to its
braces, and the belt is missing. Worth knowing before anyone relaxes the password.

## What is deployed

The built front end only: the prerendered public pages (`index.html` for `/`, and
`<path>/index.html` for `/en`, `/pricing`, `/en/pricing`, the two legal documents and their
`/en` twins), `app.html` (the empty template the shell's routes fall back to), the hashed JS
and CSS, the sanitized fixture, `sitemap.xml`, `robots.txt`, and `.htaccess`. Since
2026-09-17; `docs/seo.md` §4 says how the prerender works and §5 what `VITE_SITE_PUBLIC`
changes in this list. No server code, no worker, no secrets —
`check-secrets` runs inside the deploy script and refuses to ship a bundle carrying one.

The bundle embeds the Supabase project URL and the **publishable** key. Both are public by
design and already ship in any browser build. The service-role key, the Google client secret
and the access token are not in it, which is asserted rather than assumed.

**The dashboard is built live, and shows the demo to anyone not signed in.** This paragraph
used to say the opposite — that `VITE_DASHBOARD_SOURCE` was unset and nothing on the page was
real. It is set to `live` in `apps/web/.env.local`, which Vite loads because its root is
`apps/web`; the shipped bundle proves it, since esbuild folded the mode constant and the
`sanitized_fixture` branch is not in `index-*.js` at all.

What keeps a stranger out is not the build, it is `resolveMode`: live is a ceiling, and a
render only reaches it with a session **and** a resolved workspace. A signed-out visitor at
the same URL gets the sanitized fixture, labelled as one. A signed-in owner gets their own
channel, with RLS deciding which rows that means.

So the deployed page carries three layers between a passer-by and real data: the host's basic
auth, a session, and row-level security. Only the last of those is load-bearing.

## Deployment and CI/CD Pipeline

Deployment is automated via **GitHub Actions** (`.github/workflows/deploy.yml`), with manual local fallback when needed.

### 1. Primary: Automated CI/CD (Continuous Deployment)

Pushing to `main` triggers `.github/workflows/deploy.yml` (and it can be dispatched manually from GitHub Actions tab).
The pipeline:
1. Installs pinned dependencies (`npm ci`).
2. Runs the production build (`npm run build`).
3. Evaluates GitHub Secrets:
   - If `PREVIEW_FTP_*` secrets are configured: runs `scripts/deploy-preview.sh` over FTPS to `app.sky-develop.net`.
   - If `SUPABASE_ACCESS_TOKEN` is configured: executes `npm run db:migrate:remote` (`scripts/apply-migrations-remote.mjs`) to apply pending migrations transactionally to the remote Supabase project.

#### Required GitHub Secrets (Settings ➔ Secrets and variables ➔ Actions):
- `PREVIEW_FTP_HOST`: DirectAdmin/FTP hostname for the preview host.
- `PREVIEW_FTP_USER`: FTP username for preview document root.
- `PREVIEW_FTP_PASSWORD`: FTP password.
- `SUPABASE_ACCESS_TOKEN`: *(Optional)* Personal access token for automated Supabase Management API database migrations.

### 2. Secondary: Manual Local Deployment Fallback

If you need to trigger deployment or migrations directly from this checkout:

```bash
# Deploy web frontend to preview host:
npm run build
npm run deploy:preview

# Apply pending database migrations to live Supabase project:
npm run db:migrate:remote
```

Credentials for local execution are read from `.env.local` (or existing shell environment). The FTP account is scoped to the preview document root, so a mistake in the deploy script cannot reach the other sites on this shared host.

`--ftp-ssl-control` encrypts the login but not the data channel: this server refuses TLS on the data connection. That is acceptable only because everything shipped here is public by design. Never send anything else over it.

## Superseded assets, and two traps in removing them

The bundle is content-hashed, so every deploy writes a new filename and the previous one is
left behind — about 740KB each time. The deploy script now removes any `index-*` on the server
that the current build did not produce.

**Do not use the panel's file manager for this.** `CMD_API_FILE_MANAGER` answers a delete with
`error=0&text=Users+Deleted` and removes nothing: it reads the request as a user deletion. It
reports success either way, which is worse than failing. FTP `DELE` returns 250 and actually
deletes.

**The keep-list is space separated on purpose.** The first version built it with newlines and
compared with a `case` pattern matching on spaces, so nothing matched and the deploy deleted
the build it had just uploaded. The site kept answering 200 because Cloudflare was serving the
immutable-cached copy while the origin files were gone — a failure that would have surfaced
hours later, to a user, as a blank page. Verify a deploy against the origin with
`--resolve app.sky-develop.net:80:91.204.209.217`, not through the CDN.

## It is private, and stays private across deploys

The whole site is behind HTTP basic auth. `.htpasswd_app` lives one level above the document
root, so it cannot be served — `GET /.htpasswd_app` returns 403.

`.htaccess` lives in `apps/web/public/`, not in `dist/`. That matters: the first version was
written straight into `dist/`, which the next build silently deleted, taking the password with
it on a deployment whose entire premise is that it is not published openly. Keeping it in
`public/` makes protection the default state and removing it a deliberate edit.

Verified at the origin after a redeploy: 401 on the page, the bundle and the fixture without
credentials; 403 on the password file; 200 with them; `/account` falls back to `index.html`;
and the security headers are present.

## Cloudflare is in front, and does not point here

`app.sky-develop.net` resolves to Cloudflare, and Cloudflare serves a DirectAdmin placeholder
and its own generated `robots.txt` — not this origin. Requested directly against
`91.204.209.213` with the right `Host` header, the deployment is correct and complete.

So the deployment is done and the hostname is not yet wired to it. That is a Cloudflare-side
DNS change, outside the DirectAdmin account and outside what this project can reach.

## The host's timing varies from one request to the next

Measured 2026-09-17 while tuning the landing's fonts (`docs/verification.md`, the
`font-display: optional` entry): the same build, fetched by the same Lighthouse from the
same machine minutes apart, painted its first content at 0.7 s on one run and at 2.2 s on
the next; a third pair read 0.55 s and 2.4 s. Nothing in the page changed between runs.
The variance is the path — the shared DirectAdmin origin behind Cloudflare, whose
`cf-cache-status` reads `DYNAMIC` for HTML (`no-cache` from `.htaccess`) so every page
request reaches the origin — and it is larger than any single front-end change measured
that day, which is why a one-run Lighthouse score against this host is not evidence of
anything.

What to do with that:

- Compare builds under control, not against the host: `.cache/scratch/paint-ab.mjs`
  serves two `dist` copies locally and drives a throttled phone over both, cold, several
  runs each. That is how `swap` and `optional` were shown to be identical.
- Read Lighthouse's **observed** FCP/LCP (`audits.metrics`) beside its simulated ones; the
  simulated LCP for this page is Lantern's estimate of fonts in the critical path, and every
  trace so far has the H1 painting at first paint.
- The number that settles page speed here is field data: Core Web Vitals in Search Console
  (CrUX) once the pages have 28 days of traffic. Until then, treat lab numbers from this
  host as a range, and quote the range.
- If the range itself becomes the problem, the fix is on the hosting side — a host whose
  origin answers evenly, or an edge cache for the prerendered HTML with a purge on deploy
  (this project has no purge credential today) — not in the bundle.

## Not deployed

No Edge Function, no worker, no live data path. The Supabase project holds the schema and
anonymous isolation is verified over HTTP, but every authenticated path still needs the
service-role key.
