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
#
# How the upload is shaped, and why (2026-10-07, #94/#95 and this retry):
# - One connection per file. The host answers 425 to a second data transfer on
#   a reused control connection, which left five files truncated at 64 KB when
#   #94 reused connections. Four files go at a time (xargs -P), which is where
#   the time goes back: one curl per file cost ~2.4 s on the host.
# - Every file is uploaded under a temporary name and renamed into place on the
#   same connection (RNFR/RNTO after the transfer). A transfer that stops
#   half-way leaves a `.part` file beside the live one and never replaces it.
# - A hashed asset already on the host with the same name and size is not sent
#   again; the name carries the content hash, so same name and size is the
#   same file. A size mismatch (a truncated earlier upload) sends it again.
# - Assets first, pages last: a page is replaced only once everything it loads
#   is on the host.
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

# Files in flight at once. Each is its own connection, so this is also the
# number of logins the host sees at once; four is well under its limits.
PARALLEL=${DEPLOY_PARALLEL:-4}
export PREVIEW_FTP_HOST netrc_file

# The remote asset directory as "name size" lines. A listing this script cannot
# read (or a first deploy, where the directory does not exist yet) reads as
# empty, which only means every asset is uploaded.
remote_listing=$(curl -sS --ssl-reqd --ftp-pasv --disable-epsv \
  --netrc-file "$netrc_file" --connect-timeout 25 --max-time 120 \
  "ftp://$PREVIEW_FTP_HOST/$DIR/" 2>/dev/null \
  | awk 'NF >= 9 && $NF != "." && $NF != ".." {print $NF, $5}' || true)

already_there() {
  case "$1" in
    "$DIR"/*) ;;
    *) return 1 ;;
  esac
  size=$(wc -c < "$1" | tr -d ' ')
  printf '%s\n' "$remote_listing" | grep -qxF "${1#"$DIR"/} $size"
}

# One file, run by xargs below: upload as NAME.part, then rename it into place
# on the same connection (a quote command prefixed with "-" runs after the
# transfer). RNFR answers 350, which curl counts as a failure unless the
# command also carries "*"; RNTO must answer 2xx, so a refused rename (or an
# RNFR that really failed, after which RNTO answers 503) makes curl exit 21,
# the deploy fails and the live file is untouched. Paths come from this build
# and contain no spaces, quotes or backslashes; refuse any that do rather
# than hand curl a command it would read differently.
cat > "$work_dir/put.sh" <<'EOF'
set -eu
f=$1
case "$f" in
  *[\ \"\\]*) echo "refusing to upload odd path: $f" >&2; exit 1 ;;
esac
# curl changes into the file's directory before STOR, so the rename after
# the transfer names the file alone, not its path.
b=${f##*/}
out=$(curl -sS --ssl-reqd --ftp-pasv --disable-epsv --ftp-create-dirs \
  --netrc-file "$netrc_file" \
  -T "$f" "ftp://$PREVIEW_FTP_HOST/$f.part" \
  -Q "-*RNFR $b.part" -Q "-RNTO $b" \
  -w '%{response_code}  %{size_upload} bytes' \
  --connect-timeout 25 --max-time 300) || { printf '%-44s FAILED\n' "$f"; exit 1; }
printf '%-44s %s\n' "$f" "$out"
EOF

# Runs put.sh for each path, PARALLEL at a time. xargs exits non-zero when any
# invocation failed, which fails the deploy under set -e.
upload() {
  [ "$#" -gt 0 ] || return 0
  printf '%s\n' "$@" | xargs -P "$PARALLEL" -I '{}' sh "$work_dir/put.sh" '{}'
}

# The audit: every uploaded file must be on the host at its local size. An
# FTPS server can answer 226 for a transfer it cut short (seen on the local
# test server at exactly 114688 bytes under parallel load, and on the live
# host at 64 KB in #94), and curl then reports the full size it sent, so the
# transfer's own status is not proof. One listing per directory (a login
# each, about ten in all) is. A directory whose listing carries no sizes
# cannot be audited and is reported, not failed.
audit() {
  bad=""
  for d in $(for f in "$@"; do dirname "$f"; done | sort -u); do
    url="ftp://$PREVIEW_FTP_HOST/"
    [ "$d" = "." ] || url="$url$d/"
    listing=$(curl -sS --ssl-reqd --ftp-pasv --disable-epsv \
      --netrc-file "$netrc_file" --connect-timeout 25 --max-time 120 "$url" \
      | awk 'NF >= 9 && $5 ~ /^[0-9]+$/ {print $NF, $5}' || true)
    if [ -z "$listing" ]; then
      echo "::warning::could not audit $d: the listing carries no sizes"
      continue
    fi
    for f in "$@"; do
      [ "$(dirname "$f")" = "$d" ] || continue
      size=$(wc -c < "$f" | tr -d ' ')
      printf '%s\n' "$listing" | grep -qxF "${f##*/} $size" || bad="$bad $f"
    done
  done
  printf '%s' "$bad"
}

# Uploads, audits, re-sends what the audit refused one at a time, audits
# again, and fails the deploy on anything still wrong.
upload_audited() {
  [ "$#" -gt 0 ] || return 0
  upload "$@"
  bad=$(audit "$@")
  if [ -n "$bad" ]; then
    echo "re-sending$bad: the host holds a different size"
    # shellcheck disable=SC2086
    PARALLEL=1 upload $bad
    # shellcheck disable=SC2086
    bad=$(audit $bad)
    if [ -n "$bad" ]; then
      echo "still wrong on the host after a second send:$bad" >&2
      return 1
    fi
  fi
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

echo "uploading $(echo $assets | wc -w | tr -d ' ') asset(s); $skipped unchanged hashed asset(s) skipped"
# shellcheck disable=SC2086 # word splitting is the point: one argument per path
upload_audited $assets
echo "uploading $(echo $pages | wc -w | tr -d ' ') page(s)"
# shellcheck disable=SC2086
upload_audited $pages

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
# A leftover NAME.part from an interrupted upload is stale by the same rule.
keep=" $(find "./$DIR" -type f 2>/dev/null | sed "s|^\./$DIR/||" | tr '\n' ' ') "
remotes=$(curl -sS --ssl-reqd --ftp-pasv --disable-epsv \
  --netrc-file "$netrc_file" "ftp://$PREVIEW_FTP_HOST/$DIR/" \
  --connect-timeout 25 --max-time 120 | awk '{print $NF}' \
  | grep -vE '^\.\.?$' || true)
stale=""
for remote in $remotes; do
  case "$keep" in
    *" $remote "*) ;;
    *) stale="$stale $DIR/$remote" ;;
  esac
done
# A page's leftover .part sits at the root; sweep those too.
roots=$(curl -sS --ssl-reqd --ftp-pasv --disable-epsv \
  --netrc-file "$netrc_file" "ftp://$PREVIEW_FTP_HOST/" \
  --connect-timeout 25 --max-time 120 | awk '{print $NF}' \
  | grep -E '\.part$' || true)
for remote in $roots; do
  stale="$stale $remote"
done

# One connection per delete, PARALLEL at a time, and a file already gone is
# not a failure.
if [ -n "$stale" ]; then
  # shellcheck disable=SC2086
  printf '%s\n' $stale | xargs -P "$PARALLEL" -I '{}' sh -c '
    printf "%-44s " "removing $1"
    curl -sS --ssl-reqd --ftp-pasv --disable-epsv \
      --netrc-file "$netrc_file" "ftp://$PREVIEW_FTP_HOST/" \
      -Q "-DELE $1" -o /dev/null -w "gone\n" \
      --connect-timeout 25 --max-time 120 || echo "not removed (already gone?)"
  ' _ '{}'
fi
