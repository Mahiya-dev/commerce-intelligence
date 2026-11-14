# Environment & Setup Lokal

## 1. Prasyarat

- Node.js ≥ 20.12 (disarankan 22) dan npm
- MySQL 8.0.16+ atau MariaDB 10.6+ (lokal: paket OS, XAMPP/Laragon, atau Docker)

## 2. Variabel environment (semuanya server-side)

| Variabel              | Wajib      | Keterangan                                                                                                                                                                   |
| --------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_HOST`             | Ya         | `localhost` di cPanel (aplikasi & database di server yang sama)                                                                                                              |
| `DB_PORT`             | Tidak      | Default `3306`                                                                                                                                                               |
| `DB_USER`             | Ya         | Dari cPanel → MySQL® Databases, mis. `maduuray_app`                                                                                                                          |
| `DB_PASSWORD`         | Ya         | Password user database (karakter khusus aman — tidak perlu URL-encode)                                                                                                       |
| `DB_NAME`             | Ya         | mis. `maduuray_uci`                                                                                                                                                          |
| `DB_CONNECTION_LIMIT` | Tidak      | Ukuran pool per proses (default 5; hosting bersama membatasi koneksi)                                                                                                        |
| `DATABASE_URL`        | Alternatif | `mysql://user:pass@host:3306/db` (ganti `DB_*`; karakter khusus harus di-encode)                                                                                             |
| `DB_SSL`              | Vercel     | `true` untuk MySQL cloud (koneksi TLS terverifikasi); tidak perlu di cPanel                                                                                                  |
| `DB_SSL_CA`           | Vercel     | Sertifikat CA penyedia database (PEM; baris baru boleh ditulis `\n`)                                                                                                         |
| `APP_URL`             | Disarankan | Origin publik, mis. `https://intel.mahiya.com`. `https://` → cookie Secure `__Host-`                                                                                         |
| `APP_ENCRYPTION_KEY`  | Disarankan | 32 byte (base64), mengenkripsi API Key AI (Gemini/Groq) yang diisi Owner di dashboard. Buat: `openssl rand -base64 32`. Jika berubah/hilang, key tersimpan harus diisi ulang |
| `GEMINI_API_KEY`      | Opsional   | Kunci Google AI Studio cadangan tingkat server. Utamakan mengisinya di Pengaturan → Organisasi (terenkripsi, per organisasi)                                                 |
| `GEMINI_MODEL`        | Opsional   | ID model Gemini cadangan untuk `GEMINI_API_KEY` (mis. dipilih dari daftar model saat key diuji)                                                                              |
| `GROQ_API_KEY`        | Untuk AI   | Kunci API Groq cadangan tingkat server (console.groq.com). Utamakan mengisinya di Pengaturan → Organisasi; tanpa key manapun Insight AI nonaktif                             |
| `GROQ_MODEL`          | Tidak      | Default `openai/gpt-oss-120b`; harus mendukung structured outputs (`json_schema`)                                                                                            |
| `GROQ_BASE_URL`       | Tidak      | URL API kompatibel OpenAI; default `https://api.groq.com/openai/v1`                                                                                                          |
| `LOG_LEVEL`           | Tidak      | `debug` / `info` (default) / `warn` / `error`                                                                                                                                |

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

Untuk mengisi dashboard dengan data DEMO: login, buka **Impor Data**, unggah
`samples/phase-2/Contoh_Data_DEMO_Sep-Nov2026.xlsx`, lalu klik **Simpan ke data e-commerce** di setiap batch (urutan
yang disarankan ada di [Panduan Pengguna §6](user-guide.md)).

### 3.1 Database di macOS (Homebrew)

```bash
brew install mariadb
brew services start mariadb
```

MariaDB versi Homebrew memakai login **unix socket** untuk `root`: `sudo mariadb` bisa masuk, tetapi aplikasi (yang
terhubung lewat TCP dengan password) tidak bisa memakai `root`. Buat user khusus aplikasi:

```bash
sudo mariadb -e "
CREATE DATABASE IF NOT EXISTS uci_local CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'uci'@'localhost' IDENTIFIED BY 'UciLokal2026';
CREATE USER IF NOT EXISTS 'uci'@'127.0.0.1' IDENTIFIED BY 'UciLokal2026';
GRANT ALL PRIVILEGES ON uci_local.* TO 'uci'@'localhost';
GRANT ALL PRIVILEGES ON uci_local.* TO 'uci'@'127.0.0.1';
DROP USER IF EXISTS ''@'localhost';
FLUSH PRIVILEGES;"
```

Lalu di `.env.local`: `DB_HOST=127.0.0.1`, `DB_USER=uci`, `DB_PASSWORD=UciLokal2026`, `DB_NAME=uci_local`.

| Gejala                                                        | Penyebab                                                                          | Solusi                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ECONNREFUSED ::1:3306`                                       | `DB_HOST=localhost` diresolusi Node ke IPv6, MariaDB hanya mendengar IPv4         | `DB_HOST=127.0.0.1`                                                             |
| `SHOW DATABASES` hanya menampilkan `information_schema, test` | Login tertangkap user anonim (`''@localhost` / `''@<nama-host>`) bawaan instalasi | Hapus user anonim (`DROP USER ''@'…'`), cek `SELECT user, host FROM mysql.user` |
| `Can't connect to local server through socket`                | MariaDB belum berjalan                                                            | `brew services restart mariadb`                                                 |
| `ERROR 1396 … CREATE USER failed`                             | User sudah ada                                                                    | Abaikan; jalankan baris `GRANT`                                                 |

Homebrew bisa memasang MariaDB yang lebih baru dari produksi (mis. 13.x vs 11.4). Untuk uji lokal umumnya aman; CI
tetap menguji versi produksi.

`git push` dari Mac meminta password? GitHub tidak menerima password akun untuk Git. Pakai GitHub CLI:
`brew install gh`, `gh auth login` (HTTPS, login lewat browser), lalu push ulang.

### 3.2 Database di Windows

Pasang **MariaDB 11.4** (installer resmi, sudah termasuk HeidiSQL) atau **Laragon** (MySQL 8). **Hindari XAMPP versi
lama**: biasanya membawa MariaDB 10.4, di bawah versi minimum 10.6. Root di Windows memakai password yang dibuat saat
instalasi, jadi `DB_USER=root` boleh dipakai untuk lokal. Bila `mysql` tidak dikenali di PowerShell, gunakan
HeidiSQL atau "MySQL Client (MariaDB)" dari Start Menu.

### 3.3 Tes integrasi di lokal

Tes integrasi membuat dan menghapus database `uci_test_*` sendiri. Buat satu user khusus tes:

```bash
sudo mariadb -e "
CREATE USER IF NOT EXISTS 'citest'@'127.0.0.1' IDENTIFIED BY 'citest';
GRANT ALL ON \`uci\\_test\\_%\`.* TO 'citest'@'127.0.0.1';"
```

```bash
TEST_DB_HOST=127.0.0.1 TEST_DB_USER=citest TEST_DB_PASSWORD=citest npm run test:integration
```

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
