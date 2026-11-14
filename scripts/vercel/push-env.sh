#!/usr/bin/env bash
# Sends the database settings from .env.vercel to the Vercel project
# (Production and Preview) without printing any value. Run it yourself:
#
#   npm run vercel:env:push
#
# Existing variables with the same name are overwritten (--force).
set -euo pipefail
cd "$(dirname "$0")/../.."
FILE="${ENV_VERCEL_FILE:-.env.vercel}"
[ -f "$FILE" ] || { echo "$FILE belum ada — jalankan dulu: npm run vercel:env:create"; exit 1; }
APP_URL="${APP_URL:-https://commerce-intelligence-mahiya1.vercel.app}"

if command -v vercel >/dev/null 2>&1; then VERCEL=(vercel); else VERCEL=(npx --yes vercel@65.14.0); fi

set -a
# shellcheck disable=SC1090
. "./$FILE"
set +a
DB_CONNECTION_LIMIT=2

add() { # name value sensitive(yes/no)
  local name="$1" value="$2" sensitive="$3" env
  for env in production preview; do
    if [ "$sensitive" = yes ]; then
      printf '%s' "$value" | "${VERCEL[@]}" env add "$name" --environment "$env" --sensitive --force --yes >/dev/null
    else
      printf '%s' "$value" | "${VERCEL[@]}" env add "$name" --environment "$env" --force --yes >/dev/null
    fi
  done
  echo "✓ $name (production, preview)"
}

add DB_HOST "$DB_HOST" yes
add DB_PORT "$DB_PORT" no
add DB_USER "$DB_USER" yes
add DB_PASSWORD "$DB_PASSWORD" yes
add DB_NAME "$DB_NAME" no
add DB_SSL "$DB_SSL" no
add DB_SSL_CA "$DB_SSL_CA" yes
add DB_CONNECTION_LIMIT "$DB_CONNECTION_LIMIT" no
add APP_URL "$APP_URL" no
echo "Selesai. Deploy ulang agar terbaca: vercel --prod"
