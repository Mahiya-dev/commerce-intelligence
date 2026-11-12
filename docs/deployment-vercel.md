# Preview DEMO di Vercel

Target produksi tetap **cPanel** (lihat `docs/deployment.md`). Panduan ini membuat **preview DEMO** di Vercel:
aplikasi yang sama, dengan database MySQL cloud kecil berisi **data DEMO saja** — jangan memasukkan data bisnis
asli ke preview ini.

Perbedaan dengan cPanel:

|                         | cPanel                                          | Vercel (preview)                                                              |
| ----------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Database                | MySQL/MariaDB di server yang sama (`localhost`) | MySQL cloud, koneksi TLS (`DB_SSL=true`)                                      |
| Region                  | server hosting                                  | fungsi di Singapura (`vercel.json` → `sin1`); pilih database di Asia Tenggara |
| Batas unggah file impor | 10 MB                                           | **4,5 MB** (batas body request Vercel)                                        |
| Deploy                  | `deploy.sh` / branch `release`                  | otomatis setiap push (import repo GitHub)                                     |

## 1. Buat database MySQL cloud

Disarankan **Aiven for MySQL** (MySQL 8 asli — versi yang sama dengan yang diuji CI), paket gratis, region
terdekat dengan Singapura. Alternatif MySQL-kompatibel lain (mis. TiDB Cloud) belum diuji dengan migrasi ini.

1. Buat layanan MySQL, tunggu status _Running_.
2. Catat **host, port, user, password, nama database** (default `defaultdb`).
3. Unduh **CA certificate** layanan (file `ca.pem`).

## 2. Isi database dengan migrasi + data DEMO (dari laptop)

Buat file **`.env.vercel`** di folder proyek (sudah diabaikan git — jangan di-commit):

```bash
DB_HOST=<host>
DB_PORT=<port>
DB_USER=<user>
DB_PASSWORD=<password>
DB_NAME=defaultdb
DB_SSL=true
DB_SSL_CA="<isi ca.pem dalam satu baris, ganti setiap baris baru dengan \n>"
```

Satu baris CA bisa dibuat dengan: `awk 'NF {printf "%s\\n", $0}' ca.pem`.

Lalu (terminal baru: `source ~/.nvm/nvm.sh` dulu):

```bash
npm run db:migrate:vercel            # semua migrasi ke database cloud
npm run db:seed-demo-sales:vercel    # data DEMO + 4 akun demo + 12 bulan data
npm run db:status:vercel             # cek
```

Skrip `*:vercel` hanya memakai `.env.vercel` (tidak mencampur `.env.local`).

## 3. Import proyek di Vercel

1. vercel.com → **Add New… → Project** → pilih repo **commerce-intelligence** → **Import**.
2. Framework terdeteksi otomatis (**Next.js**). Biarkan perintah build bawaan.
3. **Environment Variables** (Production dan Preview):

   | Variabel                                                  | Nilai                                                                          |
   | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
   | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | sama seperti `.env.vercel`                                                     |
   | `DB_SSL`                                                  | `true`                                                                         |
   | `DB_SSL_CA`                                               | isi CA satu baris (sama seperti `.env.vercel`)                                 |
   | `DB_CONNECTION_LIMIT`                                     | `2` (banyak instance serverless × pool kecil)                                  |
   | `APP_ENCRYPTION_KEY`                                      | kunci baru: `openssl rand -base64 32` (jangan pakai kunci laptop/cPanel)       |
   | `APP_URL`                                                 | `https://<nama-proyek>.vercel.app` (isi setelah tahu domainnya, lalu redeploy) |

4. **Deploy**. Production Vercel memakai branch `main`; fitur Fase 3–5 baru ada di `main` setelah PR #4 di-merge.
   Sebelum itu, buka deployment preview milik branch `feat/phase-4-5` (tab _Deployments_).

## 4. Amankan preview

Akun demo memakai password yang tercantum di dokumentasi. Di URL publik, **lakukan salah satu**:

- Aktifkan **Settings → Deployment Protection → Vercel Authentication** (hanya akun Vercel tim yang bisa membuka), atau
- ganti password akun demo:

  ```bash
  npm run build:cli
  UCI_SKIP_DOTENV=1 node --env-file=.env.vercel dist/cli/admin.cjs reset-password --email owner.demo@uray.local
  ```

## 5. Cek

- `https://<domain>/api/health` → `"status":"ok"` dan `databaseReachable: true`.
- Login `owner.demo@uray.local` → Dashboard, Portofolio, Kreatif, Event, Afiliasi berisi data DEMO.
- Pengaturan → Organisasi: form API Key aktif bila `APP_ENCRYPTION_KEY` terisi.
