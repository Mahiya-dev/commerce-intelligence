# Deployment ke cPanel, Backup & Recovery

## 1. Topologi

| Komponen         | Layanan cPanel                                                                   |
| ---------------- | -------------------------------------------------------------------------------- |
| Aplikasi Next.js | **Setup Node.js App** (Phusion Passenger), startup file `server.js`              |
| Database         | **MySQL® Databases** (MySQL/MariaDB), dikelola via **phpMyAdmin**                |
| Domain           | **Subdomains** → mis. `intel.maduuray.com`, SSL via **SSL/TLS Status** (AutoSSL) |
| Cron             | **Cron Jobs** untuk housekeeping sesi & backup                                   |

### Pra-syarat hosting (cek dulu!)

- [ ] Menu **Setup Node.js App** tersedia dengan **Node.js 20 atau 22** (Next.js 16 butuh ≥ 20.9).
- [x] Versi database: **MySQL ≥ 8.0.16** atau **MariaDB ≥ 10.6** (phpMyAdmin → beranda → "Server version"). Produksi: **MariaDB 11.4.13** ✓
- [x] Setup Node.js App mendukung **Node 22.x** ✓
- [ ] Batas memori proses (CloudLinux LVE) ≥ 1 GB disarankan.
- [ ] Akses **Terminal** atau SSH (untuk menjalankan migrasi via CLI). Tanpa Terminal: gunakan jalur phpMyAdmin (§3B).

## 2. Membangun paket (di komputer lokal / CI, bukan di server)

```bash
npm ci
npm run package:cpanel          # → deploy/uray-commerce-intelligence.zip
```

Bangun di Linux x86_64 bila memungkinkan (paket tidak berisi modul native, tetapi ini menghindari kejutan).

## 3. Deploy pertama

1. **Database** — cPanel → MySQL® Databases: buat database (mis. `maduuray_uci`), buat user (`maduuray_app`,
   password kuat), _Add User To Database_ dengan **ALL PRIVILEGES**.
2. **Upload** — File Manager: upload zip ke `~/apps/`, _Extract_ → `~/apps/uray-commerce-intelligence`
   (**di luar `public_html`**).
3. **Aplikasi** — Setup Node.js App → _Create Application_:
   - Node.js version: 22.x (atau 20.x) · Application mode: Production
   - Application root: `apps/uray-commerce-intelligence`
   - Application URL: subdomain Anda · Application startup file: `server.js`
   - Environment variables: `DB_HOST=localhost`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
     `APP_URL=https://intel.maduuray.com`, `NODE_ENV=production`, `LOG_LEVEL=info`
     (alternatif: file `.env` di folder aplikasi — server dan CLI sama-sama membacanya).
   - **Jangan** klik "Run NPM Install" — dependensi sudah ada di paket.
4. **Migrasi skema** — pilih salah satu:
   - **A. Terminal (disarankan)**: salin perintah _"Enter to the virtual environment"_ dari halaman Setup Node.js
     App, lalu:
     ```bash
     cd ~/apps/uray-commerce-intelligence
     node cli/migrate.cjs          # status: node cli/migrate.cjs --status
     ```
   - **B. phpMyAdmin**: di komputer lokal jalankan `npm run db:bundle`, lalu phpMyAdmin → pilih database →
     _Import_ → `dist/migrations-phpmyadmin.sql`. Aman diimpor ulang; tercatat di `schema_migrations`.
5. **Owner pertama** (Terminal):
   ```bash
   node cli/admin.cjs create-org --name "Madu Uray" --slug madu-uray
   node cli/admin.cjs create-user --email owner@maduuray.com --name "Nama Owner"
   node cli/admin.cjs grant --org madu-uray --email owner@maduuray.com --role owner
   ```
6. **SSL** — pastikan sertifikat aktif untuk subdomain, lalu _Restart_ aplikasi.
7. **Verifikasi** — `https://intel.maduuray.com/api/health` → `{"status":"ok"}`; login sebagai owner → wajib ganti
   password → dashboard tampil; cek `/settings/audit-log`.
8. **Cron** (cPanel → Cron Jobs, harian):
   `cd ~/apps/uray-commerce-intelligence && /path/ke/nodevenv/bin/node cli/admin.cjs purge-sessions`

## 4. Rilis berikutnya

1. `npm run package:cpanel` di lokal.
2. **Backup database** (§5) sebelum migrasi.
3. Upload & extract ke folder baru (mis. `uray-commerce-intelligence-v2`), salin `.env` bila dipakai.
4. Jalankan `node cli/migrate.cjs` dari folder baru.
5. Ubah _Application root_ ke folder baru → _Restart_. Folder lama disimpan untuk rollback.

### Alur perubahan skema

- Migrasi baru: `db/migrations/NNNN_nama.sql` — ikuti aturan portabilitas di `docs/architecture.md` §4.
- Uji: `npm run test:integration` (CI menguji MySQL 8.0, MariaDB 10.6, 10.11 & 11.4 — 11.4 = versi server produksi).
- **Dilarang** mengubah skema produksi manual lewat phpMyAdmin. Runner menolak migrasi lama yang diedit.
- DDL MySQL tidak transaksional: perubahan destruktif dipecah _expand → deploy → contract_.

## 5. Backup

| Jenis                     | Cara                                                                                                   | Frekuensi                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Backup bawaan hosting     | cPanel → Backup / JetBackup (bila tersedia)                                                            | Sesuai paket hosting — **verifikasi retensinya** |
| Dump database mandiri     | Cron: `mysqldump --single-transaction --no-tablespaces DB \| gzip > ~/backups/uci_$(date +\%F).sql.gz` | Harian, retensi ≥ 14 hari                        |
| Salinan off-server        | Unduh/sinkronkan `~/backups` ke penyimpanan lain (Google Drive, dsb.)                                  | Mingguan                                         |
| File impor (mulai Fase 2) | Folder upload privat di luar `public_html` ikut dibackup                                               | Harian                                           |

Simpan kredensial di `~/.my.cnf` (chmod 600, berisi `[client] user=… password=…`) agar tidak tertulis di baris cron. `--no-tablespaces` diperlukan di MySQL ≥ 8.0.21 karena user cPanel tidak memiliki hak PROCESS.

## 6. Recovery

| Skenario                     | Tindakan                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Rilis bermasalah             | Setup Node.js App → kembalikan _Application root_ ke folder lama → Restart.                                                           |
| Migrasi gagal di tengah      | Perbaiki file migrasi yang **belum tercatat** (re-runnable), jalankan ulang. Jika sudah tercatat: buat migrasi baru (_roll-forward_). |
| Data rusak oleh impor        | (Fase 2) batalkan per `import_batch` — setiap fakta membawa `source_batch_id`.                                                        |
| Kehilangan data              | phpMyAdmin → Import dump terakhir ke database baru → verifikasi → arahkan `DB_NAME` → Restart.                                        |
| Password DB bocor            | Ganti password user di MySQL® Databases → perbarui env → Restart.                                                                     |
| Akun pengguna disalahgunakan | `node cli/admin.cjs disable-user --email …` (mencabut semua sesi seketika).                                                           |

## 7. Observability

- Log aplikasi (JSON per baris): stderr/stdout Passenger — lokasi tergantung hosting (biasanya `~/logs/` atau
  `stderr.log` di folder aplikasi).
- `/api/health` untuk uptime monitor eksternal (UptimeRobot / Better Stack, interval 1–5 menit) — juga memeriksa
  koneksi database.
- Audit Log di aplikasi untuk login, login gagal, perubahan akun & keanggotaan.
