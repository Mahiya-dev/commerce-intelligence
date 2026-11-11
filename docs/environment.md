# Environment & Setup Lokal

## 1. Prasyarat

- Node.js ≥ 20.12 (disarankan 22) dan npm
- MySQL 8.0.16+ atau MariaDB 10.6+ (lokal: paket OS, XAMPP/Laragon, atau Docker)

## 2. Variabel environment (semuanya server-side)

| Variabel              | Wajib      | Keterangan                                                                             |
| --------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `DB_HOST`             | Ya         | `localhost` di cPanel (aplikasi & database di server yang sama)                        |
| `DB_PORT`             | Tidak      | Default `3306`                                                                         |
| `DB_USER`             | Ya         | Dari cPanel → MySQL® Databases, mis. `maduuray_app`                                    |
| `DB_PASSWORD`         | Ya         | Password user database (karakter khusus aman — tidak perlu URL-encode)                 |
| `DB_NAME`             | Ya         | mis. `maduuray_uci`                                                                    |
| `DB_CONNECTION_LIMIT` | Tidak      | Ukuran pool per proses (default 5; hosting bersama membatasi koneksi)                  |
| `DATABASE_URL`        | Alternatif | `mysql://user:pass@host:3306/db` (ganti `DB_*`; karakter khusus harus di-encode)       |
| `APP_URL`             | Disarankan | Origin publik, mis. `https://intel.maduuray.com`. `https://` → cookie Secure `__Host-` |
| `GEMINI_API_KEY`      | Fase 6     | Kunci Google AI Studio untuk AI Analyst                                                |
| `GEMINI_MODEL`        | Fase 6     | ID model Gemini, ditetapkan di Fase 6                                                  |
| `LOG_LEVEL`           | Tidak      | `debug` / `info` (default) / `warn` / `error`                                          |

Tidak ada variabel `NEXT_PUBLIC_*`: satu build dapat dipakai di server mana pun hanya dengan mengubah env.

## 3. Setup lokal

```bash
cp .env.example .env.local        # isi DB_* untuk database lokal
npm ci
npm run db:migrate                # menerapkan db/migrations
npm run db:seed-demo              # data DEMO + 4 akun demo (JANGAN di produksi)
npm run dev                       # http://localhost:3000
```

Akun demo (password `UrayDemo2026!`): `owner.demo@uray.local`, `admin.demo@uray.local`,
`analyst.demo@uray.local`, `viewer.demo@uray.local`.

Seed DEMO **menolak berjalan** bila database berisi organisasi non-DEMO.

## 4. Administrasi pengguna (CLI)

Bangun CLI sekali (`npm run build:cli`), lalu (lokal: `npm run admin -- <perintah>`; di cPanel:
`node cli/admin.cjs <perintah>`):

```bash
node cli/admin.cjs create-org --name "Madu Uray" --slug madu-uray
node cli/admin.cjs create-user --email nama@maduuray.com --name "Nama Lengkap"   # mencetak password sementara
node cli/admin.cjs grant --org madu-uray --email nama@maduuray.com --role owner  # owner|admin|analyst|viewer
node cli/admin.cjs reset-password --email nama@maduuray.com                      # lupa password
node cli/admin.cjs suspend|revoke --org madu-uray --email nama@maduuray.com
node cli/admin.cjs disable-user|enable-user --email nama@maduuray.com
node cli/admin.cjs list-users
node cli/admin.cjs purge-sessions                                                 # housekeeping (cron)
```

Aturan yang ditegakkan: organisasi selalu punya minimal 1 Owner aktif; setiap perubahan tercatat di Audit Log;
reset/nonaktif mencabut semua sesi pengguna.

## 5. Perintah pengembangan

| Perintah                           | Fungsi                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run verify`                   | typecheck + lint + unit test                                                                                                   |
| `npm run test:integration`         | Uji integrasi terhadap MySQL/MariaDB nyata (`TEST_DB_HOST/PORT/USER/PASSWORD`; akun harus boleh membuat database `uci_test_*`) |
| `npm run db:migrate` / `db:status` | Terapkan / lihat status migrasi                                                                                                |
| `npm run db:bundle`                | Satu file SQL untuk phpMyAdmin → `dist/migrations-phpmyadmin.sql`                                                              |
| `npm run package:cpanel`           | Paket deploy → `deploy/uray-commerce-intelligence.zip`                                                                         |
| `npm run smoke`                    | E2E Playwright terhadap server berjalan (`BASE_URL`, `SMOKE_MODE`) — **jangan ke produksi**                                    |
