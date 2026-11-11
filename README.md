# Uray Commerce Intelligence

Aplikasi internal Madu Uray yang mengonsolidasikan kinerja e-commerce (Shopee, TikTok Shop, Tokopedia), intelijen
portofolio produk, analitik kreatif Meta, profitabilitas event, dan kinerja afiliasi Shopee HSL — dengan Gemini
sebagai AI Business Analyst (Fase 6).

**Status:** Fase 1 (fondasi, revisi stack cPanel) — lihat [`docs/phase-1-report.md`](docs/phase-1-report.md).

## Stack

Next.js 16 (App Router, TypeScript, standalone) · Tailwind CSS 4 + shadcn/ui · MySQL/MariaDB (cPanel, phpMyAdmin) ·
autentikasi lokal (scrypt + sesi database) · Vitest + Playwright · deploy ke cPanel "Setup Node.js App".

## Mulai

```bash
cp .env.example .env.local   # isi DB_*
npm ci
npm run db:migrate
npm run db:seed-demo         # data DEMO (lokal saja)
npm run dev
```

## Dokumentasi

- [Arsitektur, skema & peta rute](docs/architecture.md)
- [Environment, setup lokal & CLI admin](docs/environment.md)
- [Deployment cPanel, backup & recovery](docs/deployment.md)
- [Laporan Fase 1](docs/phase-1-report.md)

## Kualitas

```bash
npm run verify             # typecheck + lint + unit test
npm run test:integration   # terhadap MySQL/MariaDB nyata (TEST_DB_*)
npm run package:cpanel     # build + paket deploy
```

Semua data seed adalah **DEMO** (sintetis) dan diberi label di UI. Jangan gunakan sebagai hasil bisnis aktual.
