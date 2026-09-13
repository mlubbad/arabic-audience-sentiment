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

# Remove the previous build's hashed assets, which nothing references any more.
# Uploading alone would leave a ~740KB orphan behind on every deploy.
#
# DELE over FTP, not the panel's file manager: CMD_API_FILE_MANAGER answers a
# delete with "error=0&text=Users Deleted" and removes nothing, because it is
# reading the request as a user deletion. It reports success either way, which
# is worse than failing.
# Space separated, because the case pattern below matches on spaces. A
# newline-separated list matches nothing and deletes the build that was just
# uploaded — which is exactly what happened the first time this ran.
# Every hashed asset, not just index-*. The build is code-split now, so the
# chunks are named after their entry point — matching index-* alone left a
# Dashboard-*.js and an Account-*.js behind on each deploy.
keep=" $(find ./assets -type f 2>/dev/null | sed 's|^\./assets/||' | tr '\n' ' ') "
for remote in $(curl -sS --ftp-ssl-control --ftp-pasv --disable-epsv \
  -u "$PREVIEW_FTP_USER:$PREVIEW_FTP_PASSWORD" "ftp://$PREVIEW_FTP_HOST/assets/" \
  --connect-timeout 25 --max-time 120 | awk '{print $NF}' \
  | grep -vE '^\.\.?$' || true); do
  case "$keep" in
    *" $remote "*) ;;
    *)
      printf '%-44s ' "removing $remote"
      curl -sS --ftp-ssl-control --ftp-pasv --disable-epsv \
        -u "$PREVIEW_FTP_USER:$PREVIEW_FTP_PASSWORD" "ftp://$PREVIEW_FTP_HOST/" \
        -Q "-DELE assets/$remote" -o /dev/null -w 'gone\n' \
        --connect-timeout 25 --max-time 120
      ;;
  esac
done

