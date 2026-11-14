# Arsitektur — Uray Commerce Intelligence

Revisi stack (2026-11-04): **Supabase → MySQL/MariaDB di cPanel (dikelola via phpMyAdmin)**, **Vercel → cPanel
"Setup Node.js App"**, **Claude API → Gemini** untuk AI Analyst.

## 1. Stack

| Lapisan             | Teknologi                                                                  | Catatan                                                     |
| ------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Aplikasi            | Next.js 16 (App Router, TypeScript, Cache Components), output `standalone` | Dijalankan Passenger (cPanel Setup Node.js App), Node 20/22 |
| UI                  | Tailwind CSS 4 + shadcn/ui (Radix)                                         | Bahasa Indonesia                                            |
| Database            | MySQL 8.0.16+ / MariaDB 10.6+ (InnoDB, utf8mb4) via `mysql2`               | Dikelola lewat phpMyAdmin; skema hanya lewat migrasi        |
| Autentikasi         | Lokal: scrypt (Node built-in) + sesi server di tabel `sessions`            | Tanpa layanan eksternal                                     |
| AI Analyst (Fase 6) | Google Gemini API, server-side                                             | Kunci di env server; abstraksi provider                     |
| Tes                 | Vitest (unit + integrasi MySQL/MariaDB), Playwright (E2E)                  | CI matrix MySQL 8.0, MariaDB 10.6 & 10.11                   |

## 2. Prinsip

| Prinsip                                           | Implementasi                                                                                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Otorisasi di aplikasi** (MySQL tidak punya RLS) | Setiap fungsi data menerima `ActiveSession` (bukan `organization_id` mentah), selalu memfilter `session.organization.id`, dan memeriksa peran ulang. Diuji integrasi lintas 2 tenant + uji mutasi. |
| Integritas di database                            | FK komposit `(organization_id, id)`, CHECK, UNIQUE, kolom generated untuk dedupe impor.                                                                                                            |
| Tanpa trigger/stored function                     | Hosting bersama dengan binlog menolaknya tanpa SUPER. `updated_at` via `ON UPDATE CURRENT_TIMESTAMP`; audit, "minimal 1 owner", aturan bundle → service aplikasi dalam transaksi.                  |
| Angka deterministik                               | Semua metrik dihitung SQL/layanan aplikasi. AI hanya menerima metrik terstruktur + bukti.                                                                                                          |
| Data hilang ≠ nol                                 | Formatter `—`; KPI kosong "Belum ada data".                                                                                                                                                        |
| DEMO selalu berlabel                              | `organizations.is_demo` + `is_demo` per baris; badge & banner DEMO.                                                                                                                                |
| Rahasia hanya di server                           | Tidak ada variabel `NEXT_PUBLIC_*`; seluruh konfigurasi dibaca runtime di server.                                                                                                                  |

## 3. Struktur repositori

```
.
├── .github/workflows/ci.yml       # typecheck, lint, format, unit, build + integrasi (MySQL 8 / MariaDB)
├── db/migrations/                 # SATU-SATUNYA sumber perubahan skema (NNNN_nama.sql, re-runnable)
├── docs/
├── scripts/
│   ├── build-cli.mjs              # bundel src/cli/*.ts → dist/cli/*.cjs (esbuild)
│   ├── package-cpanel.sh          # paket deploy siap-upload (deploy/*.zip)
│   └── smoke-test.mjs             # E2E Playwright terhadap server berjalan
├── src/
│   ├── proxy.ts                   # cek optimistik: cookie sesi ada? (bukan batas keamanan)
│   ├── app/(auth)/                # login, ganti password, server actions
│   ├── app/(status)/              # 403, no-access
│   ├── app/(app)/                 # area terautentikasi
│   ├── app/api/health/            # probe uptime (cek koneksi DB)
│   ├── cli/                       # migrate, seed-demo, admin (pengguna & organisasi)
│   ├── components/{ui,layout,shared}
│   ├── config/navigation.ts       # peta rute + minRole + fase
│   └── lib/
│       ├── admin/users.ts         # organisasi, pengguna, keanggotaan, reset password (+ audit)
│       ├── auth/                  # password (scrypt), sessions, login (throttle), guards, roles
│       ├── data/                  # read model ber-scope tenant
│       ├── db/                    # pool mysql2, migrator, tipe baris
│       ├── master-data/           # aturan bundle, seed DEMO
│       ├── audit.ts, env.ts, format.ts, logger.ts
└── tests/{unit,integration}/
```

## 4. Skema database

✅ dibuat di Fase 1 · ⏳ fase berikutnya. ID = UUID `CHAR(36)` ascii. Semua waktu UTC (`DATETIME(3)`), dikonversi
ke zona organisasi hanya saat ditampilkan.

| Domain           | Tabel                                                                                   | Status | Catatan desain                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy & Auth   | `organizations`, `users`, `organization_members`, `sessions`, `login_attempts`          | ✅     | Peran ENUM viewer<analyst<admin<owner. Token sesi disimpan sebagai SHA-256. Email di `login_attempts` di-hash.                                                                                                                                                                   |
| Referensi        | `channels`                                                                              | ✅     | ID tetap; Shopee, TikTok Shop, Tokopedia, Meta Ads, Shopee HSL, Event.                                                                                                                                                                                                           |
| Produk           | `products`, `product_variants`, `bundle_components`                                     | ✅     | SKU = varian; bundle tidak bertingkat; `standard_cogs` (hanya analyst+).                                                                                                                                                                                                         |
| Listing          | `channel_listings`                                                                      | ✅     | Unik `(org, channel, external_product_id, external_sku_id)` dengan `''` = tanpa SKU; `units_per_listing`.                                                                                                                                                                        |
| Ingestion        | `data_mapping_profiles`, `import_batches`, `import_rows`                                | ✅     | Dedupe via kolom generated `dedupe_sha256` (NULL bila cancelled/failed). Sumber per batch (`source_kind`, 0005): unggah file, Google Sheets, API marketplace. Kode: `src/lib/imports/`.                                                                                          |
| Audit            | `audit_logs`                                                                            | ✅     | Ditulis aplikasi dalam transaksi yang sama dengan perubahan; payload disanitasi.                                                                                                                                                                                                 |
| E-commerce       | `sales_daily_facts`, `listing_daily_facts`, `sales_targets` (0006)                      | ✅     | Hanya diisi lewat commit batch impor (`src/lib/imports/commit.ts`): semua-atau-tidak, upsert idempoten, batch terakhir menang (`source_batch_id`). Listing baru dari laporan produk dibuat "belum dipetakan". KPI: `src/lib/ecommerce/kpi.ts` (murni, diuji vs `expected.json`). |
| Forecast & Alert | `forecast_runs`, `forecast_points`, `alerts`                                            | ⏳ F2+ | Forecast saat ini = run rate linear yang dihitung saat tampil (tanpa tabel). Tabel dibutuhkan saat metode forecast musiman/historis dipilih (C9).                                                                                                                                |
| Portofolio       | `touchpoint_daily_facts`, ambang matriks di `organization_kpi_settings` (0009)          | ✅     | Matriks internal (porsi GMV × pertumbuhan MoM), dihitung saat tampil dari fakta (bukan snapshot); BCG klasik menunggu data pangsa pasar eksternal. Kode: `src/lib/portfolio/`.                                                                                                   |
| Kreatif          | `creative_assets`, `meta_ads`, `creative_classifications`, `meta_ad_daily_facts` (0010) | ✅     | Ad ID asli disimpan sebagai teks; klasifikasi dari nama iklan, koreksi manual tidak ditimpa impor. Aset = metadata + tautan (tanpa unggah file). Kode: `src/lib/creative/`.                                                                                                      |
| Event            | `events`, `event_sales`, `event_costs`, `event_leads`, `variant_cogs_history` (0011)    | ✅     | COGS berversi (→ standar → komponen bundle); COGS tak diketahui ⇒ laba null, bukan 0. Lead teragregasi tanpa data pribadi. Kode: `src/lib/events/`.                                                                                                                              |
| Afiliasi         | `affiliates`, `hsl_sales_facts`, `hsl_allocations`, `inventory_movements` (0012)        | ✅     | Alokasi diusulkan → disetujui (Admin) → diterapkan; stok dicek ulang di bawah kunci baris SKU (`SELECT … FOR UPDATE`). Kode: `src/lib/affiliates/`.                                                                                                                              |
| AI               | `ai_insights`, `ai_requests` (0014)                                                     | ✅     | Insight dashboard (§7). Fingerprint data, input & output tersimpan, log permintaan untuk rate limit & biaya (MySQL, karena Passenger bisa multi-proses).                                                                                                                         |

### Aturan portabilitas migrasi (MySQL 8 + MariaDB)

1. Tanpa trigger, stored procedure/function, event.
2. Setiap statement re-runnable (`CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`) — DDL MySQL tidak transaksional.
3. Tanpa partial index → kolom `STORED` generated. Ekspresi generated tidak boleh memakai kolom `CHAR` (MariaDB).
4. CHECK tidak boleh mereferensikan kolom FK ber-`CASCADE`/`SET NULL` (MySQL).
5. Pemeriksaan case-sensitive: `CAST(x AS BINARY)` (kolom memakai collation `_ci`).
6. Hindari kata tercadang (`row_number`, `rank`, `groups`, …).
7. Jangan mengubah migrasi yang sudah diterapkan — runner menolak bila checksum berubah.

## 5. Peta rute

| Rute                                                                   | Halaman                                        | Min. peran                 | Fase             |
| ---------------------------------------------------------------------- | ---------------------------------------------- | -------------------------- | ---------------- |
| `/login`                                                               | Masuk                                          | publik                     | 1                |
| `/account/password`                                                    | Ganti password (wajib saat password sementara) | sesi                       | 1                |
| `/dashboard`                                                           | Ringkasan                                      | viewer                     | 1 (kerangka) → 2 |
| `/ecommerce` · `/portfolio` · `/creative` · `/events` · `/affiliates`  | Modul analitik                                 | viewer                     | 2–5              |
| `/ai-analyst`                                                          | AI Analyst (Gemini)                            | viewer (bertanya: analyst) | 6                |
| `/imports`                                                             | Impor Data                                     | analyst                    | 2                |
| `/master-data/products` · `/master-data/listings`                      | Master data (COGS: analyst+)                   | viewer                     | 1                |
| `/settings/organization` · `/settings/members` · `/settings/audit-log` | Pengaturan                                     | admin                      | 1                |
| `/forbidden` · `/no-access`                                            | 403 / belum punya keanggotaan                  | sesi                       | 1                |
| `/api/health`                                                          | Probe uptime                                   | publik                     | 1                |

## 6. Autentikasi & otorisasi

1. **Login**: email + password → `authenticate()` (scrypt, waktu konstan untuk email tak dikenal). Throttle: 5 gagal
   per email atau 30 per IP dalam 15 menit. Semua percobaan tercatat (email di-hash) + audit.
2. **Sesi**: token acak 256-bit di cookie `__Host-uci_session` (HttpOnly, Secure, SameSite=Lax); database hanya
   menyimpan hash SHA-256. Idle timeout 8 jam (sliding), absolut 7 hari. Logout & ganti password mencabut sesi.
3. **Proxy** hanya memeriksa keberadaan cookie (optimistik). `requireSession()/requireRole()` memvalidasi sesi
   di MySQL pada setiap halaman & action; fungsi data memeriksa peran lagi.
4. **Akun baru** dibuat admin via CLI dengan password sementara → wajib diganti saat login pertama.
5. **Lupa password**: admin menjalankan `reset-password` (Fase 1). Reset mandiri via email (SMTP cPanel) dapat
   ditambahkan di fase berikutnya bila diperlukan.

## 7. AI — Insight dashboard (Groq)

Kode: `src/lib/ai/`. Provider saat ini **Groq** (API kompatibel OpenAI, Structured Outputs `json_schema` strict);
model diatur lewat `GROQ_MODEL` (default `openai/gpt-oss-120b`). Gemini atau penyedia lain dapat ditambahkan lewat
antarmuka `AiProvider` tanpa mengubah logika insight.

- Panggilan hanya dari server (Server Action); `GROQ_API_KEY` tidak pernah ke browser.
- **Input** = metrik agregat hasil `getEcommerceOverview` (GMV, pesanan, AOV, CR, MoM, target, porsi SKU) —
  tanpa baris mentah, email, atau akses database. Input disimpan di `ai_insights.input` agar setiap insight dapat
  ditelusuri.
- **Aturan grounding**: model tidak boleh menulis angka. Setiap insight wajib merujuk 1–3 bukti berupa pasangan
  `metric` + `scope` dari daftar tertutup; **nilainya dirender aplikasi** dari input. Insight yang teksnya memuat
  digit, scope tak dikenal, atau tanpa bukti valid dibuang; bila tidak tersisa satu pun, jawaban ditolak dan tidak
  disimpan.
- **Sekali per versi data**: `data_fingerprint` = SHA-256 input. Tombol "Buat insight" (analyst+) memakai ulang
  insight bila data belum berubah (tanpa panggilan AI); bila data berubah, insight lama ditandai usang.
- **Batas pemakaian** (tabel `ai_requests`, semua hasil dihitung): 20 panggilan/organisasi/hari, 6/pengguna/jam
  (`AI_LIMITS`). Token, latensi, dan kode error dicatat untuk pemantauan biaya.
- Audit `ai.insight_generated` untuk setiap insight yang disimpan.

## 8. Keputusan arsitektur

| #   | Keputusan                                                                   | Alasan                                                                                    | Konsekuensi                                                                                 |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | MySQL/MariaDB cPanel menggantikan Supabase                                  | Arahan bisnis: infrastruktur yang sudah tersedia.                                         | Auth, RLS, Storage dibangun sendiri; isolasi tenant jadi tanggung jawab aplikasi + tes.     |
| 2   | SQL migrasi murni + runner sendiri                                          | Bisa diimpor via phpMyAdmin; transparan; tanpa ORM.                                       | Tipe baris dipelihara manual di `src/lib/db/types.ts`.                                      |
| 3   | scrypt bawaan Node, bukan bcrypt/argon2 native                              | Tanpa kompilasi native di cPanel.                                                         | Parameter tersimpan di hash; bisa dinaikkan transparan.                                     |
| 4   | Sesi di database, bukan JWT                                                 | Bisa dicabut seketika (logout, nonaktif, reset).                                          | 1 query per request terautentikasi.                                                         |
| 5   | `output: "standalone"` + paket zip                                          | cPanel Passenger menjalankan `server.js`; build tidak dilakukan di server (RAM terbatas). | Build di mesin lokal/CI Linux x86_64.                                                       |
| 6   | Cache Components tetap aktif; sesi dievaluasi saat request (`connection()`) | Validitas sesi bergantung waktu.                                                          | Halaman terautentikasi tidak di-prefetch secara runtime.                                    |
| 7   | COGS hanya untuk analyst+                                                   | Data biaya sensitif.                                                                      | Viewer melihat "Terbatas". Dapat diubah di `PERMISSIONS`.                                   |
| 8   | Komponen shadcn ditulis manual                                              | Registry shadcn tidak dapat diakses dari lingkungan build.                                | `components.json` tersedia untuk `npx shadcn add`.                                          |
| 9   | Commit impor semua-atau-tidak                                               | Baris harian yang ditolak membuat GMV MTD terlihat lebih kecil tanpa disadari.            | File dengan error harus diperbaiki dan diimpor ulang; peringatan wajib dikonfirmasi.        |
| 10  | Tanggal acuan KPI = tanggal data toko terakhir (≤ hari ini)                 | Dashboard tidak kosong saat laporan hari ini belum diunggah.                              | Label "data s.d." selalu tampil; channel yang kurang hari diberi peringatan.                |
| 11  | Ambang status target: On Track ≥ 90%, Watch ≥ 70%, selain itu At Risk       | Sesuai Kunci Jawaban; **dikonfirmasi pemilik bisnis** (Nov 2026).                         | Satu konstanta: `STATUS_THRESHOLDS` di `src/lib/ecommerce/kpi.ts`.                          |
| 12  | Groq (bukan Gemini) untuk insight; model via env                            | Pilihan pemilik produk; API kompatibel OpenAI dengan structured outputs.                  | Daftar model Groq sering berubah: ganti `GROQ_MODEL` tanpa rilis kode.                      |
| 13  | AI tidak menulis angka; bukti dirender aplikasi                             | Angka halusinasi di dashboard eksekutif lebih berbahaya daripada insight yang hilang.     | Insight yang melanggar dibuang; teks AI kualitatif, angka selalu dari database.             |
| 14  | Simpan target bulanan = Admin/Owner (`targets:manage`)                      | Target menentukan semua badge status; perubahan target adalah keputusan manajemen.        | Analyst tetap boleh unggah & validasi; commit `sales_target` ditolak (`targets_forbidden`). |
| 15  | Grafik dashboard tanpa library chart                                        | Build cPanel tetap ringan; tampilan mengikuti palet tervalidasi dan aturan dataviz.       | SVG/HTML di `src/components/charts`; seri dari `kpi.ts` (murni, diuji).                     |
