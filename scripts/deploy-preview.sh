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

work_dir=$(mktemp -d)
netrc_file="$work_dir/netrc"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup 0
trap 'exit 1' 1 2 15
: > "$netrc_file"
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

# Must match `build.assetsDir` in apps/web/vite.config.ts, which explains why
# it is not `assets`. A stale value here is not a no-op: the sweep below would
# list an empty or missing directory, delete nothing, and leave every previous
# build sitting on the host.
DIR=static

# One curl process per file cost ~2.4 s each (a fresh TLS handshake, login and
# passive channel for every file): ~3.5 min to upload ~90 files and ~1.5 min to
# delete the stale ones (2026-10-06). Now every upload goes through one curl
# process that reuses its connections, up to PARALLEL at a time, and the
# deletes share one connection.
PARALLEL=4

ftp() {
  curl -sS --ssl-reqd --ftp-pasv --disable-epsv --netrc-file "$netrc_file" \
    --connect-timeout 25 "$@"
}

# The remote asset directory as "name size" lines. A listing this script cannot
# read (or a first deploy, where the directory does not exist yet) reads as
# empty, which only means every asset is uploaded.
remote_listing=$(ftp --max-time 120 "ftp://$PREVIEW_FTP_HOST/$DIR/" 2>/dev/null \
  | awk 'NF >= 9 && $NF != "." && $NF != ".." {print $NF, $5}' || true)

# A file in $DIR carries a content hash in its name, so a remote file with the
# same name and size is this exact file and is not sent again. A size mismatch
# (a truncated earlier upload) sends it again. Every other file is always sent.
already_there() {
  case "$1" in
    "$DIR"/*) ;;
    *) return 1 ;;
  esac
  size=$(wc -c < "$1" | tr -d ' ')
  printf '%s\n' "$remote_listing" | grep -qxF "${1#"$DIR"/} $size"
}

# A curl config file: one upload-file/url pair per file. Paths come from this
# build and contain no quotes or backslashes; refuse any that do rather than
# write a config line curl would read differently.
upload_config() {
  for f in "$@"; do
    case "$f" in
      *'"'* | *'\'*) echo "refusing to upload odd path: $f" >&2; exit 1 ;;
    esac
    printf 'upload-file = "%s"\nurl = "ftp://%s/%s"\n' "$f" "$PREVIEW_FTP_HOST" "$f"
  done
}

# Returns curl's status, so a failed transfer fails the deploy under set -e.
# (Not a pipeline: sh would return the status of the last command in it.)
upload() {
  [ "$#" -gt 0 ] || return 0
  upload_config "$@" > "$work_dir/upload.conf"
  status=0
  ftp --ftp-create-dirs --max-time 600 --parallel --parallel-max "$PARALLEL" \
    -K "$work_dir/upload.conf" \
    -w '%{response_code} %{size_upload} bytes  %{url_effective}\n' \
    > "$work_dir/upload.log" || status=$?
  sed "s|ftp://[^/]*/||" "$work_dir/upload.log"
  return "$status"
}

assets=""
skipped=0
for f in $(find . -type f ! -name '*.html' | sed 's|^\./||' | sort); do
  if already_there "$f"; then
    skipped=$((skipped + 1))
  else
    assets="$assets $f"
  fi
done
pages=$(find . -type f -name '*.html' | sed 's|^\./||' | sort)

# Assets first, pages last: a page is only replaced once everything it loads is
# on the host, so a failed or interrupted upload leaves the previous pages
# serving the previous (still present) assets.
echo "uploading $(echo $assets | wc -w | tr -d ' ') asset(s); $skipped unchanged hashed asset(s) skipped"
# shellcheck disable=SC2086 # word splitting is the point: one argument per path
upload $assets
echo "uploading $(echo $pages | wc -w | tr -d ' ') page(s)"
# shellcheck disable=SC2086
upload $pages

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
stale=""
for remote in $(printf '%s\n' "$remote_listing" | awk '{print $1}'); do
  case "$keep" in
    *" $remote "*) ;;
    *) stale="$stale $remote" ;;
  esac
done

if [ -n "$stale" ]; then
  echo "removing$stale"
  # All deletes on one connection. If that fails part-way (a file already
  # gone), fall back to one connection per file, ignoring failures as before.
  for remote in $stale; do
    printf 'quote = "-DELE %s/%s"\n' "$DIR" "$remote"
  done > "$work_dir/delete.conf"
  if ! ftp --max-time 300 -K "$work_dir/delete.conf" -o /dev/null \
    "ftp://$PREVIEW_FTP_HOST/"; then
    for remote in $stale; do
      printf '%-44s ' "removing $remote"
      ftp --max-time 120 "ftp://$PREVIEW_FTP_HOST/" \
        -Q "-DELE $DIR/$remote" -o /dev/null -w 'gone\n' || true
    done
  fi
fi
