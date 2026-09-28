#!/bin/sh
# Publishes apps/web/dist to the private preview host over FTP.
#
# Credentials come from .env.local, which is gitignored. The FTP account is
# scoped to the preview document root, so a mistake here cannot reach the other
# sites on this shared host.
#
# --ssl-reqd requires TLS for the control and data channels. Credentials live in
# a mode-0600 netrc file for the duration of the run so they never appear in a
# curl process argument.
set -eu
cd "$(dirname "$0")/.."
if [ -f ./.env.local ]; then
  . ./.env.local
fi

: "${PREVIEW_FTP_HOST:?set PREVIEW_FTP_HOST in environment or .env.local}"
: "${PREVIEW_FTP_USER:?set PREVIEW_FTP_USER in environment or .env.local}"
: "${PREVIEW_FTP_PASSWORD:?set PREVIEW_FTP_PASSWORD in environment or .env.local}"

netrc_file=$(mktemp)
cleanup() {
  rm -f "$netrc_file"
}
trap cleanup 0
trap 'exit 1' 1 2 15
chmod 600 "$netrc_file"
printf 'machine %s\nlogin %s\npassword %s\n' \
  "$PREVIEW_FTP_HOST" "$PREVIEW_FTP_USER" "$PREVIEW_FTP_PASSWORD" > "$netrc_file"
unset PREVIEW_FTP_USER PREVIEW_FTP_PASSWORD

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
  curl -sS --ssl-reqd --ftp-pasv --disable-epsv --ftp-create-dirs \
    --netrc-file "$netrc_file" \
    -T "$f" "ftp://$PREVIEW_FTP_HOST/$f" \
    -w '%{http_code}  %{size_upload} bytes\n' \
    --connect-timeout 25 --max-time 300
done

# Must match `build.assetsDir` in apps/web/vite.config.ts, which explains why
# it is not `assets`. A stale value here is not a no-op: the sweep below would
# list an empty or missing directory, delete nothing, and leave every previous
# build sitting on the host.
DIR=static

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
keep=" $(find "./$DIR" -type f 2>/dev/null | sed "s|^\./$DIR/||" | tr '\n' ' ') "
remotes=$(curl -sS --ssl-reqd --ftp-pasv --disable-epsv \
  --netrc-file "$netrc_file" "ftp://$PREVIEW_FTP_HOST/$DIR/" \
  --connect-timeout 25 --max-time 120 | awk '{print $NF}' \
  | grep -vE '^\.\.?$' || true)
[ -z "$remotes" ] || for remote in $remotes; do
  case "$keep" in
    *" $remote "*) ;;
    *)
      printf '%-44s ' "removing $remote"
      curl -sS --ssl-reqd --ftp-pasv --disable-epsv \
        --netrc-file "$netrc_file" "ftp://$PREVIEW_FTP_HOST/" \
        -Q "-DELE $DIR/$remote" -o /dev/null -w 'gone\n' \
        --connect-timeout 25 --max-time 120 || true
      ;;
  esac
done
