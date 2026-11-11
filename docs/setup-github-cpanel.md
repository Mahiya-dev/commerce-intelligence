# Menyambungkan Claude ↔ GitHub ↔ cPanel (SSH)

Gambaran alur:

```
Claude (sesi cloud) ──push──▶ GitHub (repo privat) ──pull (deploy key, read-only)──▶ cPanel (SSH)
```

Prinsip keamanan:

- Claude **tidak pernah** memegang password cPanel atau private key SSH. Claude hanya menulis ke GitHub.
- cPanel hanya punya akses **baca** ke repo (deploy key read-only). Kalau server dibobol, repo tetap aman.
- Jangan pernah menempelkan private key, password, atau isi `.env` ke chat.

---

## Bagian A — Buat repo privat di GitHub (±3 menit)

1. Login ke github.com, klik **+** (kanan atas), lalu **New repository**.
2. Isi kolom berikut:
   - **Owner**: akun Anda atau organisasi Madu Uray.
   - **Repository name**: `commerce-intelligence`
   - **Private** ✅
   - **Jangan** centang "Add a README", ".gitignore", atau "license". Repo harus **kosong**, karena isinya akan dikirim dari sesi Claude.
3. Klik **Create repository** dan catat nama lengkapnya, misalnya `Mahiya-dev/commerce-intelligence`.

Disarankan: aktifkan **2FA** di akun GitHub (Settings, lalu Password and authentication).

## Bagian B — Hubungkan Claude ke GitHub (±3 menit)

1. Buka **https://claude.ai/connect-github** dengan akun Claude yang Anda pakai sekarang.
2. Klik connect/authorize akun GitHub Anda.
3. Saat diminta memasang **Claude GitHub App**, pilih **Only select repositories**, lalu pilih `commerce-intelligence` saja. Jangan beri akses ke semua repo.
   - Kalau repo dibuat di bawah **organisasi** GitHub, aplikasi harus dipasang oleh owner organisasi tersebut.
4. Kirimkan nama repo (`owner/repo`) ke Claude di sesi ini.

Setelah itu Claude yang mengerjakan:

- Menyambungkan repo ke sesi ini, lalu commit seluruh pekerjaan Fase 1 dan sampel Fase 2.
- Push ke branch kerja. Untuk penggabungan ke `main`, Claude membuat pull request **hanya bila Anda minta**.

Untuk sesi Claude berikutnya, **pilih repo ini saat memulai sesi** agar kode langsung tersedia.

## Bagian C — Aktifkan SSH di cPanel (±10 menit)

1. Login cPanel dan cari **SSH Access**.
   - Kalau menu ini tidak ada, atau ada tapi koneksi ditolak, minta provider hosting untuk **mengaktifkan shell access**. Jailed shell sudah cukup.
   - Tanyakan juga **port SSH**. Banyak hosting tidak memakai port 22, misalnya 2222 atau 64000.
2. Buka **SSH Access**, lalu **Manage SSH Keys**, lalu **Generate a New Key**:
   - Key Name: `id_ed25519_laptop`. Isi juga passphrase yang kuat.
   - Key Type: **ED25519**. Kalau tidak tersedia, pilih RSA 4096.
   - Klik **Generate**.
3. Kembali ke daftar **Public Keys**, cari key tadi, klik **Manage**, lalu **Authorize**.
4. Di daftar **Private Keys**, klik **View/Download** dan simpan file private key-nya di laptop Anda, misalnya `C:\Users\<nama>\.ssh\id_ed25519_laptop`. Setelah itu, sebaiknya hapus private key ini dari cPanel.
   - Alternatif yang lebih aman: buat key di laptop (`ssh-keygen -t ed25519`), lalu gunakan **Import Key** di cPanel dan **tempel public key saja**.
5. Uji koneksi dari laptop. Di Windows gunakan PowerShell, di Mac/Linux gunakan Terminal:

   ```bash
   ssh -i ~/.ssh/id_ed25519_laptop -p PORT_SSH USER_CPANEL@DOMAIN_ANDA
   ```

   Kalau berhasil, Anda akan melihat prompt seperti `[USER_CPANEL@server ~]$`.

### C.1 Bila SSH dari laptop gagal

**Penting:** SSH dari laptop **tidak wajib** untuk melanjutkan. Bagian D cukup dijalankan di menu **Terminal** cPanel
(di browser). Bila menu Terminal ada, lanjutkan ke Bagian D dan selesaikan SSH laptop belakangan.

Jalankan dengan mode diagnosis, lalu cocokkan pesan terakhirnya:

```bash
ssh -v -i ~/.ssh/id_ed25519_laptop -p PORT_SSH USER_CPANEL@DOMAIN_ANDA
```

| Pesan                                                                 | Penyebab                                                | Solusi                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Connection timed out`                                                | Port salah, atau firewall hosting memblokir IP Anda     | Tanyakan port SSH ke provider (sering bukan 22). Beberapa hosting mewajibkan **whitelist IP** di cPanel/tiket support  |
| `Connection refused`                                                  | SSH tidak aktif di port itu                             | Port salah atau shell access belum diaktifkan provider                                                                 |
| `Permission denied (publickey)`                                       | Key belum **Authorize**, key salah, atau username salah | cPanel → Manage SSH Keys → Authorize; username = **username cPanel** (bukan email/domain); cek path `-i`               |
| `Permission denied (publickey,password)` setelah input password       | Login password dinonaktifkan / password salah           | Gunakan key, bukan password                                                                                            |
| `UNPROTECTED PRIVATE KEY FILE` / `bad permissions`                    | Izin file key terlalu longgar                           | Mac/Linux: `chmod 600 ~/.ssh/id_ed25519_laptop`. Windows: lihat perintah di bawah                                      |
| `invalid format` / `load pubkey ... invalid format`                   | Key berformat PuTTY (`.ppk`) atau file terunduh rusak   | Gunakan key format OpenSSH, atau buat key di laptop (`ssh-keygen -t ed25519`) lalu **Import** public key-nya di cPanel |
| Login berhasil lalu langsung tertutup / `Shell access is not enabled` | Paket hosting tanpa shell                               | Minta provider mengaktifkan (jailed) shell                                                                             |

Windows — perbaiki izin key (PowerShell):

```powershell
icacls $env:USERPROFILE\.ssh\id_ed25519_laptop /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

Kirim ke Claude **pesan error dan ±15 baris terakhir** output `ssh -v` (tidak berisi key, tapi samarkan domain/username
bila perlu). **Jangan** kirim isi file key.

## Bagian D — Izinkan cPanel menarik kode dari GitHub (±10 menit)

Lakukan di **terminal SSH cPanel** dari Bagian C. Cara lain: buka cPanel, lalu menu **Terminal**.

1. Buat key khusus untuk GitHub, **tanpa passphrase**, supaya bisa dipakai otomatis:

   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   ssh-keygen -t ed25519 -f ~/.ssh/github_uci -N "" -C "cpanel-deploy-uci"
   cat ~/.ssh/github_uci.pub
   ```

2. Salin **satu baris** keluaran `cat` (yang diawali `ssh-ed25519`). Ini public key, jadi aman untuk disalin.
3. Di GitHub, buka repo, lalu **Settings**, **Deploy keys**, **Add deploy key**:
   - Title: `cPanel production`
   - Key: tempel baris tadi.
   - **Allow write access: JANGAN dicentang** (read-only).
4. Kembali ke terminal cPanel dan atur agar GitHub memakai key tersebut:

   ```bash
   cat >> ~/.ssh/config <<'EOF'
   Host github.com
     HostName github.com
     User git
     IdentityFile ~/.ssh/github_uci
     IdentitiesOnly yes
   EOF
   chmod 600 ~/.ssh/config
   ssh -T git@github.com
   ```

   Jawab `yes` saat ditanya fingerprint. Hasil yang benar: `Hi Mahiya-dev/commerce-intelligence! You've successfully authenticated...`
   - Kalau muncul `Connection refused` atau timeout, berarti hosting memblokir koneksi keluar ke port 22. Coba ganti `HostName ssh.github.com` dan tambahkan baris `Port 443`, lalu ulangi. Kalau masih gagal, minta provider membuka akses keluar ke `github.com`.

5. Kirim ke Claude **teks hasil** `ssh -T git@github.com` saja (bukan isi key).

## Bagian E — Alur deploy (sudah aktif)

Server **tidak melakukan build**: `next build` membutuhkan memori besar dan bisa dihentikan batas LVE (CloudLinux).

1. Kode masuk ke `main`, lalu **GitHub Actions** menjalankan tes (MySQL 8.0, MariaDB 10.6/10.11/11.4).
2. Bila semua lulus, job **release** membangun paket `standalone` dan menerbitkannya sebagai commit di branch `release`.
3. Anda men-deploy dari terminal cPanel dengan satu perintah: `./deploy.sh` (backup DB, pasang kode, migrasi,
   restart, health check; `--rollback` untuk kembali).

Langkah lengkap deploy pertama & rilis berikutnya: `docs/deployment.md` §3–4.

## Checklist yang dikirim ke Claude

- [ ] Nama repo `owner/repo` (Bagian A–B)
- [ ] Konfirmasi SSH cPanel berhasil login (Bagian C), tanpa mengirim key
- [ ] Hasil `ssh -T git@github.com` dari cPanel (Bagian D)
