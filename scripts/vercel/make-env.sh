#!/usr/bin/env bash
# Builds .env.vercel (DEMO preview database) from your Aiven MySQL connection
# details. Values are typed by you; nothing is printed back, and the file is
# created with permissions 600. .env* files are ignored by git.
#
#   npm run vercel:env:create
#
# The CA certificate is read from the clipboard (Aiven → Connection
# information → CA certificate → Show/copy), or from CA_FILE=path/to/ca.pem.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${ENV_VERCEL_FILE:-.env.vercel}"

if [ -f "$OUT" ]; then
  read -r -p "$OUT sudah ada. Timpa? (y/N) " answer
  [ "$answer" = "y" ] || { echo "Dibatalkan."; exit 1; }
fi

echo "Isi dari Aiven → layanan MySQL → Overview → Connection information."
read -r -p "Host (mis. xxx.aivencloud.com): " DB_HOST
read -r -p "Port: " DB_PORT
read -r -p "User [avnadmin]: " DB_USER
DB_USER="${DB_USER:-avnadmin}"
read -r -s -p "Password (tidak ditampilkan): " DB_PASSWORD
echo
read -r -p "Database [defaultdb]: " DB_NAME
DB_NAME="${DB_NAME:-defaultdb}"

[[ "$DB_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Host tidak valid."; exit 1; }
[[ "$DB_PORT" =~ ^[0-9]{2,5}$ ]] || { echo "Port harus angka."; exit 1; }
[ -n "$DB_PASSWORD" ] || { echo "Password kosong."; exit 1; }
case "$DB_PASSWORD" in *"'"*) echo "Password mengandung tanda kutip tunggal; ganti password di Aiven."; exit 1 ;; esac

if [ -n "${CA_FILE:-}" ]; then
  CA="$(cat "$CA_FILE")"
else
  read -r -p "Salin CA certificate di Aiven (Show → copy), lalu tekan Enter… " _
  CA="$(pbpaste)"
fi
case "$CA" in
  *"BEGIN CERTIFICATE"*"END CERTIFICATE"*) ;;
  *) echo "Isi clipboard bukan CA certificate (harus berisi BEGIN/END CERTIFICATE)."; exit 1 ;;
esac
CA_ONE_LINE="$(printf '%s\n' "$CA" | awk 'NF {printf "%s\\n", $0}')"

umask 077
{
  echo "# DEMO preview database (Aiven MySQL) — dibuat oleh scripts/vercel/make-env.sh"
  printf 'DB_HOST=%s\n' "$DB_HOST"
  printf 'DB_PORT=%s\n' "$DB_PORT"
  printf "DB_USER='%s'\n" "$DB_USER"
  printf "DB_PASSWORD='%s'\n" "$DB_PASSWORD"
  printf 'DB_NAME=%s\n' "$DB_NAME"
  echo "DB_SSL=true"
  printf 'DB_SSL_CA="%s"\n' "$CA_ONE_LINE"
} > "$OUT"
chmod 600 "$OUT"
echo "✓ $OUT dibuat (izin 600). Langkah berikutnya: npm run db:migrate:vercel"
