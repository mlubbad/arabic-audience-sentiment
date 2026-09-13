# Private preview deployment

`app.sky-develop.net`, on the shared DirectAdmin host (`skydevelop` account, `u92286`,
origin `91.204.209.213`). Fixture-backed, password-protected, and not indexed.

## What is deployed

The built front end only: `index.html`, one hashed JS bundle, one hashed CSS file, the
sanitized fixture, `robots.txt`, and `.htaccess`. No server code, no worker, no secrets —
`check-secrets` runs inside the deploy script and refuses to ship a bundle carrying one.

The bundle embeds the Supabase project URL and the **publishable** key. Both are public by
design and already ship in any browser build. The service-role key, the Google client secret
and the access token are not in it, which is asserted rather than assumed.

**The dashboard serves fixtures.** `VITE_DASHBOARD_SOURCE` is unset, so the live read path is
not active, and nothing on the deployed page is real data.

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
