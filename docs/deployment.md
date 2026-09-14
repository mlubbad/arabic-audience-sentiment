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

The built front end only: `index.html`, one hashed JS bundle, one hashed CSS file, the
sanitized fixture, `robots.txt`, and `.htaccess`. No server code, no worker, no secrets —
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

## Redeploying

```bash
npm run build
npm run deploy:preview
```

Credentials come from `.env.local`, which is gitignored. The FTP account is scoped to the
preview document root, so a mistake in the deploy script cannot reach the other sites on this
shared host — and there are several, including a live WordPress install on the main domain.

`--ftp-ssl-control` encrypts the login but not the data channel: this server refuses TLS on
the data connection. That is acceptable only because everything shipped here is public by
design. Never send anything else over it.

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

## Not deployed

No Edge Function, no worker, no live data path. The Supabase project holds the schema and
anonymous isolation is verified over HTTP, but every authenticated path still needs the
service-role key.
