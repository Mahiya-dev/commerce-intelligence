# Deploy di Vercel

**Keputusan (Nov 2026):** selama platform masih dikembangkan, aplikasi berjalan di **Vercel** dengan database MySQL
cloud (Aiven). Setelah pengembangan selesai, produksi dipindah ke **cPanel** (lihat `docs/deployment.md`).

## Alur update otomatis

| Kejadian                 | Yang terjadi di Vercel                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Merge / push ke `main`   | Deployment **Production**: `npm run vercel-build` menerapkan migrasi yang belum ada, lalu `next build`.   |
| Migrasi gagal            | Build gagal; Vercel **tetap melayani deployment sebelumnya**. Perbaiki lalu push ulang.                   |
| Push ke branch lain / PR | Deployment **Preview** tanpa migrasi (migrasi yang belum di-merge tidak boleh mengubah database bersama). |

Jadi setelah sebuah PR di-merge, Vercel sudah versi terbaru tanpa langkah manual. Skrip: `scripts/vercel/build.sh`.

> Preview dan Production memakai **database yang sama**. Preview sebuah PR yang membawa migrasi baru bisa error di
> halaman yang memakai tabel baru sampai PR di-merge; itu normal. Karena database berisi data asli, aktifkan
> **Deployment Protection** (§4) agar URL preview tidak bisa dibuka publik.

Perbedaan dengan cPanel:

|                         | cPanel                                          | Vercel                                                                        |
| ----------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Database                | MySQL/MariaDB di server yang sama (`localhost`) | MySQL cloud, koneksi TLS (`DB_SSL=true`)                                      |
| Region                  | server hosting                                  | fungsi di Singapura (`vercel.json` → `sin1`); pilih database di Asia Tenggara |
| Batas unggah file impor | 10 file, 10 MB/file, total 25 MB                | total **4,5 MB** per unggahan (batas body request Vercel)                     |
| Deploy                  | `deploy.sh` / branch `release`                  | otomatis setiap push; production menerapkan migrasi dulu (`vercel-build`)     |

## Penyiapan awal (sekali)

### 1. Buat database MySQL cloud

Disarankan **Aiven for MySQL** (MySQL 8 asli — versi yang sama dengan yang diuji CI), paket gratis, region
terdekat dengan Singapura. Alternatif MySQL-kompatibel lain (mis. TiDB Cloud) belum diuji dengan migrasi ini.

1. Buat layanan MySQL, tunggu status _Running_.
2. Catat **host, port, user, password, nama database** (default `defaultdb`).
3. Unduh **CA certificate** layanan (file `ca.pem`).

### 2. Isi database dengan migrasi + data DEMO (dari laptop)

Buat **`.env.vercel`** (diabaikan git, izin 600) dengan skrip — skrip menanyakan host, port, user dan password
(tidak ditampilkan) lalu mengambil CA certificate dari clipboard (Aiven → Connection information → CA certificate →
Show → copy):

```bash
npm run vercel:env:create
```

Lalu (terminal baru: `source ~/.nvm/nvm.sh` dulu):

```bash
npm run db:migrate:vercel            # semua migrasi ke database cloud
npm run db:seed-demo-sales:vercel    # data DEMO + 4 akun demo + 12 bulan data
npm run db:status:vercel             # cek
```

Skrip `*:vercel` hanya memakai `.env.vercel` (tidak mencampur `.env.local`).

### 3. Import proyek di Vercel

1. vercel.com → **Add New… → Project** → pilih repo **commerce-intelligence** → **Import**.
2. Framework terdeteksi otomatis (**Next.js**). Biarkan perintah build bawaan.
3. **Environment Variables** (Production dan Preview) — kirim dari `.env.vercel` tanpa menampilkan nilainya
   (jalankan sendiri; juga mengisi `DB_CONNECTION_LIMIT=2` dan `APP_URL`):

   ```bash
   npm run vercel:env:push
   ```

   `APP_ENCRYPTION_KEY` dibuat sekali, langsung di Vercel:

   ```bash
   openssl rand -base64 32 | tr -d '\n' | vercel env add APP_ENCRYPTION_KEY --environment production --sensitive
   openssl rand -base64 32 | tr -d '\n' | vercel env add APP_ENCRYPTION_KEY --environment preview --sensitive --yes
   ```

4. **Deploy**. Production Vercel memakai branch `main`; fitur Fase 3–5 baru ada di `main` setelah PR #4 di-merge.
   Sebelum itu, buka deployment preview milik branch `feat/phase-4-5` (tab _Deployments_).

### 4. Amankan preview

Akun demo memakai password yang tercantum di dokumentasi. Di URL publik, **lakukan salah satu**:

- Aktifkan **Settings → Deployment Protection → Vercel Authentication** (hanya akun Vercel tim yang bisa membuka), atau
- ganti password akun demo:

  ```bash
  npm run build:cli
  UCI_SKIP_DOTENV=1 node --env-file=.env.vercel dist/cli/admin.cjs reset-password --email owner.demo@uray.local
  ```

### 5. Cek

- `https://<domain>/api/health` → `"status":"ok"` dan `databaseReachable: true`.
- Login `owner.demo@uray.local` → Dashboard, Portofolio, Kreatif, Event, Afiliasi berisi data DEMO.
- Pengaturan → Organisasi: form API Key aktif bila `APP_ENCRYPTION_KEY` terisi.

### 6. Menghapus seluruh data DEMO

Perintah ini menghapus organisasi **Madu Uray (DEMO)** beserta semua datanya (penjualan, impor, portofolio,
kreatif, event, afiliasi, pengaturan, audit) dan keempat akun `*.demo@uray.local`, dalam satu transaksi.
Hanya organisasi bertanda DEMO yang bisa dihapus; organisasi asli dan tabel referensi (channel) tidak tersentuh.
**Tidak bisa dibatalkan** — data DEMO bisa dibuat ulang dengan `db:seed-demo-sales`.

```bash
npm run db:remove-demo:vercel   # database preview Vercel (.env.vercel)
npm run db:remove-demo          # database lokal (.env.local)
```

Setelah itu belum ada akun untuk login. Buat organisasi dan Owner asli (password sementara ditampilkan sekali,
wajib diganti saat login pertama):

```bash
npm run build:cli
# untuk database Vercel, awali setiap perintah dengan: UCI_SKIP_DOTENV=1 node --env-file=.env.vercel …
node dist/cli/admin.cjs create-org --name "Madu Uray" --slug madu-uray
node dist/cli/admin.cjs create-user --email nama@perusahaan.com --name "Nama Owner"
node dist/cli/admin.cjs grant --org madu-uray --email nama@perusahaan.com --role owner
```

Dashboard akan kosong ("Belum ada data") sampai laporan asli diimpor lewat **Impor Data**.
