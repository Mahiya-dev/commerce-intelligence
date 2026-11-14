#!/usr/bin/env bash
# Vercel build (package.json "vercel-build"; Vercel runs it instead of "build").
#
# Production deployments (push/merge to main) apply pending database migrations
# BEFORE building, so the schema is never behind the code. If a migration fails
# the build fails and Vercel keeps serving the previous deployment.
# Preview deployments (other branches / PRs) never migrate: an unmerged
# migration must not change the shared database.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "▶ Production: menerapkan migrasi database"
  npm run build:cli
  UCI_SKIP_DOTENV=1 node dist/cli/migrate.cjs
else
  echo "▶ ${VERCEL_ENV:-lokal}: migrasi dilewati (hanya production)"
fi

next build
