# Uray Commerce Intelligence

Aplikasi internal Madu Uray untuk menyatukan kinerja penjualan Shopee, TikTok Shop, dan Tokopedia dalam satu
dashboard: GMV, pesanan, AOV, conversion rate, progres target, forecast, dan kontribusi per SKU. Modul berikutnya
mencakup portofolio produk, kreatif Meta, profitabilitas event, afiliasi Shopee HSL, dan AI Business Analyst
(Groq).

Prinsip yang dipegang di seluruh aplikasi: **data kosong tidak pernah ditampilkan sebagai nol**, setiap angka
menyebut sumber dan tanggal datanya, dan data DEMO selalu berlabel.

## Status

| Fase | Isi                                                                                                        | Status          |
| ---- | ---------------------------------------------------------------------------------------------------------- | --------------- |
| 1    | Fondasi: login & peran, multi-organisasi, master produk & listing, audit log, deploy cPanel                | ✅ Selesai      |
| 2    | Impor data (Excel/CSV, Google Sheets), validasi, simpan ke tabel fakta, KPI & grafik dashboard, E-Commerce | ✅ Inti selesai |
| 2+   | Forecast musiman, halaman pemetaan listing → SKU, koneksi API marketplace                                  | ⏳              |
| 3–5  | Portofolio produk, kreatif Meta, profitabilitas event, afiliasi Shopee HSL                                 | ⏳              |
| 6    | Insight AI di dashboard (Groq) ✅ · AI Analyst tanya-jawab ⏳                                              | Sebagian        |

Belum di-deploy ke server produksi. Langkahnya ada di [Deployment](docs/deployment.md).

## Dokumentasi

Mulai dari dokumen yang sesuai dengan peran Anda:

| Saya ingin…                                           | Baca                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Memakai aplikasi: impor data, membaca KPI             | [Panduan Pengguna](docs/user-guide.md)               |
| Menjalankan aplikasi di laptop (Windows/Mac)          | [Environment & setup lokal](docs/environment.md)     |
| Men-deploy ke cPanel, backup, rollback                | [Deployment](docs/deployment.md)                     |
| Menyambungkan GitHub ↔ cPanel (SSH, deploy key)       | [Setup GitHub & cPanel](docs/setup-github-cpanel.md) |
| Memahami arsitektur, skema database, keputusan desain | [Arsitektur](docs/architecture.md)                   |
| Melihat hasil verifikasi Fase 1                       | [Laporan Fase 1](docs/phase-1-report.md)             |

## Mulai cepat (lokal)

Butuh Node.js 22 dan MariaDB ≥ 10.6 / MySQL ≥ 8.0.16. Langkah lengkap per sistem operasi ada di
[docs/environment.md](docs/environment.md).

```bash
cp .env.example .env.local   # isi DB_* (di Mac: DB_HOST=127.0.0.1)
npm ci
npm run db:migrate
npm run db:seed-demo         # data & akun DEMO — jangan dijalankan di produksi
npm run dev                  # http://localhost:3000
```

Login dengan `owner.demo@uray.local` / `UrayDemo2026!`, lalu unggah
`samples/phase-2/Contoh_Data_DEMO_Sep-Nov2026.xlsx` di menu **Impor Data** untuk mengisi dashboard.

## Stack

Next.js 16 (App Router, TypeScript, output `standalone`) · Tailwind CSS 4 + shadcn/ui · MySQL/MariaDB via `mysql2`
(skema hanya lewat migrasi SQL) · autentikasi lokal (scrypt + sesi di database) · Vitest + Playwright · CI GitHub
Actions · deploy ke cPanel "Setup Node.js App" (Passenger).

## Alur kerja perubahan kode

```
branch → pull request → CI hijau → merge ke main → CI membangun paket ke branch `release` → ./deploy.sh di cPanel
```

- **CI** (`.github/workflows/ci.yml`) menjalankan typecheck, lint, format, unit test, build, dan tes integrasi di
  MySQL 8.0 serta MariaDB 10.6, 10.11, dan **11.4 (versi produksi)**.
- **Branch `release`** berisi paket siap jalan dan dibuat otomatis setelah semua tes di `main` lulus. Server tidak
  pernah membangun aplikasi sendiri.
- **Produksi hanya berubah saat `./deploy.sh` dijalankan manual** di server: backup database, pasang kode,
  migrasi, restart, dan health check. Kode otomatis kembali ke versi lama bila migrasi gagal.

Perintah pemeriksaan lokal:

```bash
npm run verify             # typecheck + lint + unit test
npm run test:integration   # terhadap MySQL/MariaDB nyata (TEST_DB_*), lihat docs/environment.md
npm run package:cpanel     # build + paket deploy (sama dengan yang dibuat CI)
```

## Struktur singkat

```
db/migrations/        satu-satunya sumber perubahan skema (NNNN_nama.sql, aman dijalankan ulang)
samples/phase-2/      template impor standar, data DEMO, dan kunci jawaban KPI (expected.json)
scripts/              paket cPanel, deploy.sh, generator sampel
src/app/              halaman (App Router) dan server action
src/lib/imports/      baca file, validasi, staging, commit ke tabel fakta
src/lib/ecommerce/    rumus KPI (fungsi murni, diuji terhadap kunci jawaban)
src/lib/data/         read model per organisasi (isolasi tenant)
tests/                unit dan integrasi
```

Detail lengkap: [docs/architecture.md](docs/architecture.md) §3.

## Keterbatasan yang diketahui

- **Insight AI** baru diuji dengan Groq tiruan; panggilan ke Groq sungguhan terbukti setelah `GROQ_API_KEY` diisi.
- **Ambang status target** (On Track ≥ 90%, Watch ≥ 70%) belum dikonfirmasi pemilik bisnis. Lihat
  [arsitektur §8 #11](docs/architecture.md).
- **Izin target**: target bulanan saat ini bisa disimpan oleh peran Analyst lewat impor, padahal izin
  `targets:manage` di `src/lib/auth/roles.ts` disiapkan untuk Admin. Perlu diputuskan mana yang berlaku.
- Batch yang sudah disimpan belum bisa dibatalkan. Koreksi dilakukan dengan mengimpor ulang file yang sudah
  diperbaiki, yang menimpa data lama.
- Belum diuji di server cPanel sungguhan: restart Passenger dan batas memori hosting baru terbukti saat deploy
  pertama.

Semua data seed dan sampel adalah **DEMO** (sintetis). Jangan gunakan sebagai hasil bisnis aktual.
