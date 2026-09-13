#!/bin/sh
# Publishes apps/web/dist to the private preview host over FTP.
#
# Credentials come from .env.local, which is gitignored. The FTP account is
# scoped to the preview document root, so a mistake here cannot reach the other
# sites on this shared host.
#
# --ftp-ssl-control encrypts the login but not the data channel: this server
# refuses TLS on the data connection. That is acceptable only because every byte
# shipped here is public by design — a built front-end bundle and a sanitized
# fixture. Never send anything else through it.
set -eu
cd "$(dirname "$0")/.."
. ./.env.local

: "${PREVIEW_FTP_HOST:?set PREVIEW_FTP_HOST in .env.local}"
: "${PREVIEW_FTP_USER:?set PREVIEW_FTP_USER in .env.local}"
: "${PREVIEW_FTP_PASSWORD:?set PREVIEW_FTP_PASSWORD in .env.local}"

if [ ! -f apps/web/dist/index.html ]; then
  echo "no build found; run: npm run build" >&2
  exit 1
fi

# Refuse to ship a bundle carrying a secret, rather than trusting that the last
# build was clean.
node scripts/check-secrets.mjs >/dev/null

cd apps/web/dist
find . -type f | sed 's|^\./||' | while read -r f; do
  printf '%-44s ' "$f"
  curl -sS --ftp-ssl-control --ftp-pasv --disable-epsv --ftp-create-dirs \
    -T "$f" "ftp://$PREVIEW_FTP_HOST/$f" \
    -u "$PREVIEW_FTP_USER:$PREVIEW_FTP_PASSWORD" \
    -w '%{http_code}  %{size_upload} bytes\n' \
    --connect-timeout 25 --max-time 300
done
