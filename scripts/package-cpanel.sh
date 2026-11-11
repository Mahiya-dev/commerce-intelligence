#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Builds a self-contained deployment package for cPanel "Setup Node.js App".
#
#   npm run package:cpanel
#
# Output: deploy/uray-commerce-intelligence/  (+ a .zip next to it)
#   server.js            ← Application startup file in cPanel
#   .next/, node_modules/ (traced, production only)
#   public/
#   db/migrations/       SQL migrations
#   cli/*.cjs            migrate / seed-demo / admin tools
#   .env.example         template; create .env next to server.js on the server
#
# Build on a machine with the SAME OS family/arch as the server when possible
# (Linux x86_64). Nothing in this package needs compiling on the server.
# -----------------------------------------------------------------------------
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/deploy/uray-commerce-intelligence"
cd "$ROOT"

echo "→ Build Next.js (standalone)"
npm run build
echo "→ Bundle CLI"
node scripts/build-cli.mjs

echo "→ Assemble $OUT"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R .next/standalone/. "$OUT/"
mkdir -p "$OUT/.next" && cp -R .next/static "$OUT/.next/static"
[ -d public ] && cp -R public "$OUT/public"
mkdir -p "$OUT/db" && cp -R db/migrations "$OUT/db/migrations"
mkdir -p "$OUT/cli" && cp dist/cli/*.cjs "$OUT/cli/"
cp .env.example "$OUT/.env.example"

# Never ship local secrets.
find "$OUT" -maxdepth 1 -name ".env*" ! -name ".env.example" -delete

cat > "$OUT/DEPLOY.txt" <<'TXT'
Uray Commerce Intelligence — paket cPanel
1. Upload & extract folder ini ke luar public_html, mis. ~/apps/uray-commerce-intelligence
2. cPanel → Setup Node.js App → Create Application
     Node.js version : 20.x atau 22.x
     Application root: apps/uray-commerce-intelligence
     Application URL : subdomain Anda
     Startup file    : server.js
3. Isi Environment variables (lihat .env.example) ATAU buat file .env di folder ini.
4. Terminal cPanel (masuk ke virtualenv app):  node cli/migrate.cjs
5. Owner pertama:  node cli/admin.cjs create-org ... / create-user ... / grant ...
6. Restart aplikasi di Setup Node.js App. Cek https://<subdomain>/api/health
Panduan lengkap: docs/deployment.md di repositori.
TXT

if command -v zip >/dev/null 2>&1; then
  (cd "$ROOT/deploy" && rm -f uray-commerce-intelligence.zip && zip -qr uray-commerce-intelligence.zip uray-commerce-intelligence)
  echo "✓ deploy/uray-commerce-intelligence.zip"
else
  echo "✓ $OUT (zip tidak tersedia; kompres manual)"
fi
