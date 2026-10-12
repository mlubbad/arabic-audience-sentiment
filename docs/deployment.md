# Deployment

`app.sky-develop.net` is served from the shared DirectAdmin host `chronos.hostns.io`
(origin `91.204.209.217`), account `u101542`. The domain's document root is
`/home/u101542/domains/app.sky-develop.net/public_html/`, and Cloudflare sits in front:
the hostname resolves to Cloudflare addresses (`104.21.9.166`, `172.67.160.214`, checked
2026-10-03), not to the origin.

The site is public. There has been no Basic Auth since 2026-09-16 (see the head of
`apps/web/public/.htaccess`), and whether search engines may index the public pages is
decided by one build flag, `VITE_SITE_PUBLIC`, described in `docs/seo.md`.

Earlier versions of this file named the `skydevelop` account (`u92286`) and origin
`91.204.209.213`. That is no longer where the site lives; do not deploy there.

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
real. It is set to `live`: in CI by the `VITE_DASHBOARD_SOURCE` repository Variable, locally by
`apps/web/.env.local`, which Vite loads because its root is `apps/web`. The shipped bundle
proves it, since esbuild folded the mode constant and the
`sanitized_fixture` branch is not in `index-*.js` at all.

What keeps a stranger out is not the build, it is `resolveMode`: live is a ceiling, and a
render only reaches it with a session **and** a resolved workspace. A signed-out visitor at
the same URL gets the sanitized fixture, labelled as one. A signed-in owner gets their own
channel, with RLS deciding which rows that means.

So the deployed page carries two layers between a passer-by and real data: a session and
row-level security. The second is the one that is load-bearing.

## Deployment and CI/CD Pipeline

Deployment is automated by `.github/workflows/deploy.yml`. Agents never run it by hand and
never apply remote migrations; the owner can dispatch it from the Actions tab.

### When it runs

It never runs on a push. It runs after the **Credential-free checks** workflow completes
successfully for a push to `main` (or by `workflow_dispatch` on `main`), and its first job
refuses to continue unless both of these passed for that exact commit:

- the `verify` job of `ci.yml`;
- the Secret scan, Semgrep SAST and Dependency audit jobs of `security.yml`.

### What it does, in order

1. `npm ci`, then the build-safety checks (`check:secrets`, `typecheck`).
2. **Build.** `npm run build` runs with the public `VITE_*` values from repository
   Variables. It stops before anything else happens if `VITE_SUPABASE_URL` or
   `VITE_SUPABASE_PUBLISHABLE_KEY` is missing (#58).
3. **Migrate.** `npm run db:migrate:remote` applies pending migrations to the Supabase
   project, each in its own transaction.
4. **Upload.** `scripts/deploy-preview.sh` runs `check-secrets` against the built bundle,
   uploads `dist/` over FTPS (`curl --ssl-reqd`, so TLS on both the control and data
   channels), then deletes the previous build's hashed files from `static/`.
5. **Verify.** `scripts/verify-deploy.mjs` fetches `/account` on the public host and
   requires it to load the entry script this build produced (#57). Without this step an
   upload to the wrong folder looks exactly like success; see the incident below.

### Repository Secrets (Settings → Secrets and variables → Actions → Secrets)

- `PREVIEW_FTP_HOST`: `chronos.hostns.io`. Use the server name, not the domain: the domain
  resolves to Cloudflare, which does not carry FTP.
- `PREVIEW_FTP_USER`: `deploy@app.sky-develop.net`, an FTP account whose root **is**
  `public_html` (DirectAdmin → FTP Accounts). Never the account's main login.
- `PREVIEW_FTP_PASSWORD`: that FTP account's password.
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`: used for the remote migrations.

### Repository Variables (same page → Variables)

These values are compiled into the bundle every visitor downloads, so they are public by
design. They live in Variables, never in tracked files, and **only `VITE_*` names belong
here**. Variables are shown in plain text, so a service-role key, an `sb_secret_` key, a
Paddle API key or any password must never be stored as one. If such a value reaches the
bundle, `check-secrets` blocks the upload.

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | `https://ykqugctewsqvevhyqtbi.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | The `sb_publishable_…` key. A legacy `eyJ…` JWT fails `check-secrets`. |
| `VITE_AUTH_PROVIDERS` | for sign-in | e.g. `google` |
| `VITE_GOOGLE_CLIENT_ID` | for One Tap | public OAuth client id |
| `VITE_DASHBOARD_SOURCE` | for live data | `live` |
| `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENV` | for checkout | `test_…` with `sandbox`, `live_…` with `live` |
| `VITE_SITE_URL`, `VITE_SITE_PUBLIC` | optional | see `docs/seo.md` |

### Manual local fallback

`npm run build && npm run deploy:preview` reads the same names from `.env.local`. Use the
scoped `deploy@` FTP account there too. With the main account, files land in
`/home/u101542/`, not on the site, and the upload still reports success.

## Incident 2026-10-02/03: deploys that never went live, then a live build without sign-in

**What happened.** Deploys #95–#98 reported FTP `226` for every file and finished green,
but the site kept serving a build uploaded by hand on 2026-09-24. The OAuth Connect flow
then failed in production with "unknown", because that old page did not handle
`connect=pending`.

**Cause 1: the wrong folder.** The secrets used the main DirectAdmin login, whose FTP root
is `/home/u101542/`, so every CI build landed beside `domains/`, not inside `public_html`.

- **Fix:** the owner created the scoped `deploy@app.sky-develop.net` account, rooted at
  `public_html`, and changed `PREVIEW_FTP_HOST` to `chronos.hostns.io`.
- **Result:** Deploy #99 swept the stale live build (`index-Bl0nMJSR.js` and its chunks).
- **Guard:** #57 added the live-host verification step, which passed on #100 and #102.

**Cause 2: no build configuration in CI.** The build step had never received any `VITE_*`
values. Every CI build was therefore the fixture-only preview, with `vendor-supabase` at
1 byte and sign-in disabled. Nobody noticed while those builds went to the wrong folder;
the moment #99 put one live, production lost sign-in.

- **Fix:** #58 reads the values from repository Variables and refuses to build without
  the Supabase pair.
- **Result:** Deploy #102 built `vendor-supabase` at 226 KB and was verified live
  (`app.sky-develop.net serves /static/index-C2uKPfyQ.js`).

**Lessons.**

- An upload proves that bytes reached an FTP account, not that the site serves them.
- A chunk of 1 byte where a library should be means the build is missing configuration.

The CI uploads that landed outside `public_html` (`/home/u101542/en`, `static`, `landing`,
`fonts`, `fixtures`, `privacy-policy`, `pricing`, `terms` and the top-level files of
`dist/`) are not served and can be deleted from the panel.

## How the upload is shaped (2026-10-12)

`scripts/deploy-preview.sh` learned from #94 (2026-10-07), which reused FTPS connections and
was reverted the same day: the host answers `425` to a second data transfer on a reused
control connection, and five files were left truncated at 64 KB. The shape now:

- **One connection per file, four at a time** (`xargs -P 4`). No connection is ever asked
  for a second transfer. The time comes back from the parallelism: one curl per file cost
  about 2.4 s on the host, so ~90 files took about 3.5 minutes in sequence.
- **A temporary name, then a rename.** Each file lands as `NAME.part` and is renamed into
  place on the same connection (`RNFR`/`RNTO` after the transfer). A transfer that stops
  leaves a `.part` beside the live file and never replaces it; the sweep removes `.part`
  leftovers on the next deploy.
- **A size audit after each batch.** An FTPS server can answer `226` for a transfer it cut
  short (seen on the local test server at exactly 114688 bytes under parallel load), and curl
  then reports the full size it sent, so the transfer's status is not proof. After the
  assets and again after the pages, one listing per directory is compared with the local
  sizes; a mismatch is re-sent once, one file at a time, and a second mismatch fails the
  deploy. In the local stress run, one of four deploys needed this re-send and ended whole.
- **Unchanged hashed assets are skipped.** A file in `static/` with the same name and size on
  the host is the same file (the name carries the content hash); a size mismatch, a truncated
  earlier upload, sends it again.
- **Assets first, pages last**, so a page is replaced only once everything it loads is on
  the host.

The script was exercised against a local FTPS server (pyftpdlib, TLS required on both
channels, a 0.5 s login delay) with the real build: empty host, unchanged host, stale and
truncated remote files with a leftover `.part`, a refused `STOR` and a refused `RNTO`. The
record is in `docs/verification.md` under 2026-10-12.

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

## `.htaccess` travels with every build

`.htaccess` lives in `apps/web/public/`, not in `dist/`. The first version was written
straight into `dist/`, and the next build silently deleted it. Keeping it in `public/` means
every deploy ships the rewrite rules, cache headers and security headers. The Basic Auth
block it once carried was removed on 2026-09-16 at the owner's instruction.

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

## What is not part of this pipeline

- **Edge Functions** (`supabase/functions/*`: `oauth-start`, `oauth-callback`,
  `oauth-complete`, `channel-lookup`, `paddle-checkout`, `paddle-webhook`,
  `billing-portal`, `worker`). The owner deploys these with `supabase functions deploy`;
  CI does not.
- **The Python worker.** It runs on the owner's machine as a LaunchAgent
  (`scripts/worker-service-update.sh`).
