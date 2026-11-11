# Laporan Fase 1 — Fondasi (Revisi Stack cPanel)

Tanggal: 2026-11-04 · Status: **Selesai, menunggu persetujuan untuk Fase 2**

## 0. Ringkasan revisi

| Permintaan                              | Implementasi                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Hapus Anthropic Claude API              | Semua kode, env & dokumentasi Claude/Anthropic dihapus.                                                                               |
| Tanpa Vercel                            | `vercel.json` dihapus. Build `standalone` + paket zip untuk cPanel **Setup Node.js App**.                                             |
| Supabase → MySQL (phpMyAdmin di cPanel) | Supabase dihapus. Migrasi MySQL/MariaDB, autentikasi & sesi sendiri, otorisasi tenant di aplikasi, CLI admin, jalur impor phpMyAdmin. |
| AI Analyst → Gemini                     | Env `GEMINI_API_KEY` / `GEMINI_MODEL`; rancangan integrasi di `docs/architecture.md` §7 (implementasi Fase 6).                        |

## 1. Kriteria penerimaan

| #   | Kriteria                                                                 | Status | Bukti                                                        |
| --- | ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------ |
| 1   | Next.js + TypeScript, build produksi `standalone`                        | ✅     | `npm run package:cpanel`                                     |
| 2   | Tailwind 4 + shadcn/ui, token DEMO                                       | ✅     | Screenshot dashboard/audit                                   |
| 3   | Layout + sidebar responsif                                               | ✅     | E2E mobile 375 px tanpa overflow, menu mobile berfungsi      |
| 4   | Koneksi database MySQL/MariaDB + validasi konfigurasi                    | ✅     | `/api/health` memeriksa koneksi; pesan jelas bila env kosong |
| 5   | Migrasi awal (re-runnable, checksum, bundle phpMyAdmin)                  | ✅     | 4 migrasi, 14 tabel; diuji di MariaDB 10.11 & MySQL 8.0.46   |
| 6   | Autentikasi: login, logout, throttle, ganti password, password sementara | ✅     | E2E login nyata untuk 4 peran + pengguna baru                |
| 7   | Rute terlindungi berbasis peran (UI + server + data layer)               | ✅     | E2E 403; uji integrasi isolasi tenant + uji mutasi           |
| 8   | Placeholder modul dengan state kosong eksplisit                          | ✅     | KPI "—" / "Belum ada data"                                   |
| 9   | Seed DEMO berlabel, idempoten, menolak DB produksi                       | ✅     | Uji integrasi                                                |
| 10  | Instruksi environment                                                    | ✅     | `docs/environment.md`, `.env.example`                        |
| 11  | Konfigurasi dev lokal & deployment cPanel                                | ✅     | `docs/deployment.md`, `scripts/package-cpanel.sh`, CI        |

## 2. Hasil verifikasi (benar-benar dijalankan)

| Pemeriksaan                                                                                                    | Hasil                                                |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Typecheck · Lint (0 warning) · Prettier                                                                        | Lulus                                                |
| Unit test (Vitest)                                                                                             | **70/70**                                            |
| Integrasi — **MariaDB 10.11** (user non-SUPER, binlog ON = kondisi cPanel)                                     | **30/30**                                            |
| Integrasi — **MySQL 8.0.46** (user non-SUPER, binlog ON)                                                       | **30/30**                                            |
| **MariaDB 11.4.13 (= versi produksi)**: integrasi · impor bundle phpMyAdmin 2× · E2E penuh di Node 22          | **30/30** · OK · **18/18**                           |
| Uji mutasi: filter tenant sengaja dihapus dari satu query                                                      | Tes gagal sesuai harapan → isolasi benar-benar diuji |
| Simulasi deploy cPanel: zip diekstrak ke folder bersih, `.env` lokal, CLI migrate/seed/admin, `node server.js` | Berhasil; tidak ada error server                     |
| E2E Playwright — mode penuh (DB + akun demo)                                                                   | **18/18**                                            |
| E2E Playwright — mode tanpa konfigurasi DB                                                                     | **9/9**                                              |

Cakupan E2E mode penuh: redirect tanpa sesi, cookie palsu ditolak tanpa kebocoran data, validasi form, error
generik, **lockout setelah 5 gagal**, open-redirect dinetralkan, viewer (nav terbatas, COGS tersembunyi, 403),
analyst (COGS terlihat, settings 403), admin (anggota & audit login), listing belum terpetakan, **pengguna baru
wajib ganti password sementara**, logout mencabut sesi, mobile.

Masalah yang ditemukan & diperbaiki selama verifikasi:

1. MariaDB menolak kolom `CHAR` di ekspresi generated → `file_sha256` menjadi `VARCHAR(64)`.
2. `row_number` kata tercadang di MySQL 8/MariaDB → `source_row`.
3. DDL MySQL tidak transaksional → semua statement migrasi dibuat re-runnable.
4. Next.js runtime prefetch mengevaluasi waktu saat validasi sesi → `connection()` sebelum resolusi sesi.
5. Cookie sesi tanpa DB terkonfigurasi menampilkan halaman error → kini diarahkan ke `/login` dengan penjelasan.
6. Audit mencatat perubahan peran yang tidak mengubah apa pun → no-op dilewati.

## 3. Keterbatasan & yang belum terverifikasi

- **Belum diuji di server cPanel Anda.** Simulasi memakai `node server.js` langsung, bukan Passenger. Perilaku
  Passenger (binding port, path log, batas memori LVE) harus dicek saat deploy pertama — checklist di
  `docs/deployment.md` §1.
- Versi Node.js & database di hosting Anda belum diketahui (butuh Node ≥ 20.9; MySQL ≥ 8.0.16 / MariaDB ≥ 10.6).
  MariaDB 10.6 hanya diuji via CI (belum dijalankan di sini); 10.11 dan MySQL 8.0 sudah.
- Lupa password = reset oleh admin via CLI (belum ada reset mandiri via email).
- Belum ada UI undang pengguna/ubah peran — via CLI (`node cli/admin.cjs`).
- Isolasi tenant kini **tanggung jawab kode aplikasi** (tidak ada RLS). Setiap query baru di fase berikutnya wajib
  memakai pola `ActiveSession` + uji integrasi lintas tenant.
- Tipe baris DB dipelihara manual (`src/lib/db/types.ts`).
- Belum ada Content-Security-Policy; header keamanan lain aktif.
- Organisasi aktif = keanggotaan pertama (belum ada pemilih organisasi).

## 4. Cara memverifikasi

Lokal: `docs/environment.md` §3. Di cPanel: `docs/deployment.md` §3, lalu:

1. `https://<subdomain>/api/health` → `"status":"ok"`.
2. Login owner dengan password sementara → dipaksa ke halaman ganti password → dashboard.
3. Buat akun viewer & analyst via CLI; pastikan viewer tidak melihat _Impor Data_/_Pengaturan_ dan COGS
   "Terbatas"; analyst melihat COGS.
4. 5× password salah → pesan lockout; cek entri "Login gagal" di Audit Log.
5. `node cli/admin.cjs disable-user --email …` → sesi pengguna tersebut langsung berakhir.

## 5. Keputusan yang perlu dikonfirmasi

| #   | Keputusan                                                                                                                                              | Rekomendasi                                                                                                                                | Dampak                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 1   | Hosting mendukung **Setup Node.js App** (Node 20/22)?                                                                                                  | ✅ Terkonfirmasi: Node 22.x                                                                                                                | Selesai                                     |
| 2   | Versi MySQL/MariaDB di hosting                                                                                                                         | ✅ MariaDB 11.4.13 — diuji, lihat §2                                                                                                       | Selesai                                     |
| 3   | Visibilitas COGS (saat ini: analyst ke atas)                                                                                                           | Pertahankan                                                                                                                                | Ubah 1 baris bila Viewer perlu melihat      |
| 4   | Reset password mandiri via email (SMTP cPanel)                                                                                                         | Tambahkan di Fase 2 bila tim > 10 orang                                                                                                    | Saat ini admin harus reset manual           |
| 5   | Definisi GMV per channel (gross/net voucher, batal, refund)                                                                                            | ✅ GMV Seller Center: termasuk diskon/voucher **dan pesanan batal**; basis tanggal dibayar; hanya untuk optimasi (P&L pakai final revenue) | Selesai                                     |
| 6   | Definisi MoM periode setara                                                                                                                            | Hari 1..N vs hari 1..N bulan lalu                                                                                                          | Memblokir Fase 2                            |
| 7   | Ambang On Track / Watch / At Risk                                                                                                                      | ✅ ≥90% On Track · 70–<90% Watch · <70% At Risk (dari expected)                                                                            | Selesai                                     |
| 8   | Contoh file ekspor Shopee, TikTok Shop, Tokopedia                                                                                                      | Aplikasi memetakan ekspor asli (dipilih) → butuh 1 file per laporan per channel                                                            | **Memblokir pemetaan impor**                |
| 9   | Gemini: tier gratis vs berbayar (ketentuan Gemini API: data tier gratis dapat dipakai Google untuk meningkatkan produk — verifikasi ketentuan terbaru) | **Berbayar** untuk data bisnis asli                                                                                                        | Risiko kerahasiaan data                     |
| 10  | Repositori Git                                                                                                                                         | Repo privat                                                                                                                                | Kode masih hanya ada di container sementara |
