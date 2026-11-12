# Panduan Pengguna

Panduan ini untuk tim yang memakai aplikasi sehari-hari: mengimpor laporan marketplace, menyimpannya, dan membaca
dashboard. Tidak perlu pengetahuan teknis.

## 1. Peran dan akses

Setiap pengguna punya satu peran per organisasi. Peran yang lebih tinggi mencakup semua akses peran di bawahnya.

| Peran       | Bisa melakukan                                                                                |
| ----------- | --------------------------------------------------------------------------------------------- |
| **Viewer**  | Melihat dashboard, halaman E-Commerce, master produk dan listing. Tidak melihat COGS.         |
| **Analyst** | Semua akses Viewer, ditambah: melihat COGS, **mengimpor data dan menyimpannya** ke dashboard. |
| **Admin**   | Semua akses Analyst, ditambah: mengelola anggota dan melihat Audit Log.                       |
| **Owner**   | Semua akses Admin, ditambah: pengaturan organisasi.                                           |

Akun baru dibuat oleh admin dengan password sementara. Saat login pertama, Anda wajib menggantinya. Setelah 5 kali
salah password, login untuk email tersebut dikunci sementara (15 menit).

## 2. Alur singkat: dari laporan marketplace ke dashboard

```
1. Unduh laporan dari Seller Center   →   2. Salin ke Template Standar Impor
3. Unggah di menu Impor Data           →   4. Periksa hasil validasi
5. Klik "Simpan ke data e-commerce"    →   6. Angka muncul di Dashboard & E-Commerce
```

Data **baru muncul di dashboard setelah langkah 5**. Mengunggah file saja belum mengubah angka apa pun.

## 3. Menyiapkan file

### 3.1 Template standar

Gunakan `Template_Standar_Impor.xlsx` (folder `samples/phase-2/` atau minta ke admin). Ada 4 jenis laporan:

| Template                | Isi                                            | Dipakai untuk                              |
| ----------------------- | ---------------------------------------------- | ------------------------------------------ |
| `kinerja_toko_harian`   | 1 baris = 1 channel pada 1 tanggal             | GMV, pesanan, AOV, conversion rate, target |
| `kinerja_produk_harian` | 1 baris = 1 listing pada 1 tanggal             | Kontribusi per SKU internal                |
| `target_bulanan`        | 1 baris = target 1 channel pada 1 bulan        | Progres target, status, forecast           |
| `master_listing`        | 1 baris = 1 listing marketplace → SKU internal | Memetakan listing ke produk Madu Uray      |

Lembar **Kamus Kolom** di template menjelaskan setiap kolom. Hapus baris contoh berwarna abu-abu sebelum mengunggah.

### 3.2 Aturan pengisian

| Kolom             | Format yang benar                    | Contoh salah                         |
| ----------------- | ------------------------------------ | ------------------------------------ |
| Tanggal           | `YYYY-MM-DD`                         | `31/09/2026`, `10 Nov 2026`          |
| Bulan             | `YYYY-MM`                            | `Nov 2026`                           |
| Channel           | `shopee`, `tiktok_shop`, `tokopedia` | `Shopee Mall`, `TikTok`              |
| Angka (GMV, dll.) | bilangan bulat tanpa pemisah         | `13.054.500`, `13,05 jt`, `Rp 13 jt` |

- **Kolom opsional yang kosong berarti "data tidak tersedia", bukan nol.** Jangan isi `0` bila datanya memang
  tidak ada, karena angka 0 akan ikut dihitung.
- Jangan mengubah baris header (baris 1). Urutan kolom boleh berbeda, nama kolom harus sama.
- Satu workbook Excel boleh berisi beberapa sheet sekaligus, dengan nama sheet sama seperti nama template. Setiap
  sheet menjadi satu batch tersendiri.

### 3.3 Batas file

- Ukuran maksimal **10 MB**, maksimal **50.000 baris** per sheet.
- Format: `.xlsx` atau `.csv` (UTF-8, pemisah `,` atau `;`). Format `.xls` lama tidak didukung; simpan ulang
  sebagai `.xlsx`.

## 4. Mengimpor data

Menu **Impor Data** (peran Analyst ke atas). Pilih salah satu sumber:

| Sumber                 | Cara                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unggah Excel/CSV**   | Pilih file, klik impor.                                                                                                                      |
| **Google Spreadsheet** | Tempel URL spreadsheet. Atur berbagi ke **"Siapa saja yang memiliki link: Pelihat"**. Yang diambil hanya tab yang terbuka di URL (`#gid=…`). |
| **API marketplace**    | Belum aktif. Membutuhkan kredensial aplikasi partner dari Shopee / TikTok Shop.                                                              |

Setelah impor, setiap batch tampil di **Riwayat impor** dengan status:

| Status          | Arti                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| **Tervalidasi** | Sudah dicek, tersimpan sementara (staging). **Belum** masuk dashboard. |
| **Tersimpan**   | Sudah masuk ke data e-commerce dan dipakai dashboard.                  |
| **Dibatalkan**  | Tidak dipakai. File yang sama boleh diimpor ulang.                     |

File yang **persis sama** dengan batch aktif ditolak sebagai duplikat. Batalkan batch lama dulu bila memang ingin
mengimpor ulang file yang sama.

## 5. Membaca hasil validasi

Buka batch dengan **Lihat hasil**. Setiap masalah ditampilkan per baris dan per kolom.

### 5.1 Error (baris ditolak)

| Pesan tentang…                   | Penyebab umum                                    | Perbaikan                                    |
| -------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| Tanggal / bulan tidak valid      | Format `DD/MM/YYYY`, atau tanggal yang tidak ada | Ubah ke `YYYY-MM-DD`                         |
| Tanggal di masa depan            | Salah ketik tahun atau bulan                     | Periksa tanggal                              |
| Channel tidak dikenal            | Nama channel bebas, misalnya "Shopee Mall"       | Pakai `shopee` / `tiktok_shop` / `tokopedia` |
| Angka tidak valid                | Ada titik ribuan, "jt", "Rp", atau desimal       | Isi bilangan bulat polos                     |
| Nilai negatif / di bawah minimum | Angka minus atau target 0                        | Periksa sumber                               |
| Wajib diisi                      | Kolom wajib kosong                               | Lengkapi                                     |
| Baris duplikat                   | Tanggal + channel (+ listing) yang sama dua kali | Hapus salah satu                             |

**Batch yang punya satu saja baris error tidak bisa disimpan.** Perbaiki file, lalu impor ulang, dan batalkan batch
yang lama. Aturan ini sengaja: bila satu hari data dilewati, GMV bulan berjalan terlihat lebih kecil dari kenyataan
tanpa ada yang sadar.

### 5.2 Peringatan (baris tetap valid)

| Peringatan                  | Arti                                                           |
| --------------------------- | -------------------------------------------------------------- |
| Conversion rate > 100%      | Pesanan lebih banyak dari pengunjung. Biasanya kolom tertukar. |
| Pesanan / GMV batal > total | Angka batal lebih besar dari totalnya. Periksa laporan sumber. |

Baris dengan peringatan tetap bisa disimpan, tetapi Anda harus mencentang **"Saya sudah meninjau … baris dengan
peringatan"** terlebih dahulu.

## 6. Menyimpan ke data e-commerce

Di halaman batch yang tervalidasi tanpa error, panel **Simpan ke data e-commerce** menunjukkan apa yang akan terjadi:

- **data baru**: tanggal/channel yang belum pernah ada;
- **data yang akan ditimpa**: tanggal/channel yang sudah ada akan diganti dengan isi file ini;
- **listing baru** (laporan produk): listing yang belum dikenal dibuat dengan status **belum dipetakan**.

Klik **Simpan ke data e-commerce**. Semua baris disimpan sekaligus, atau tidak sama sekali bila terjadi gangguan.

### Urutan yang disarankan untuk impor pertama

1. `master_listing`: supaya listing sudah terpetakan ke SKU.
2. `target_bulanan`
3. `kinerja_toko_harian`
4. `kinerja_produk_harian`

### Mengoreksi data yang sudah tersimpan

Impor ulang file yang sudah diperbaiki untuk periode yang sama, lalu simpan. Data lama untuk tanggal dan channel
tersebut **ditimpa**, bukan ditambahkan, jadi tidak ada angka ganda. Batch yang sudah tersimpan belum bisa dibatalkan
langsung.

### Master listing dan SKU internal

- `sku_internal` harus sudah ada di **Master Produk**. Bila ada SKU yang tidak dikenal, penyimpanan ditolak dan
  daftar SKU-nya ditampilkan.
- `sku_internal` yang dikosongkan **tidak menghapus** pemetaan yang sudah ada.
- `isi_per_listing` dipakai untuk menghitung unit SKU. Contoh: listing "Isi 2" yang terjual 10 = 20 unit SKU.

## 7. Membaca Dashboard dan halaman E-Commerce

### 7.1 Periode yang ditampilkan

Angka dihitung **sampai tanggal data toko terakhir**, bukan sampai hari ini. Label **"data s.d. 10 Nov 2026"** selalu
ditampilkan. Jadi bila laporan hari ini belum diunggah, dashboard tetap menampilkan gambaran terakhir yang lengkap.

Bila ada channel yang kekurangan hari (misalnya Tokopedia baru sampai tanggal 8, channel lain sampai tanggal 10),
muncul peringatan **"Data belum lengkap"**. Angka channel tersebut akan terlihat lebih rendah dari kenyataan sampai
laporannya diimpor.

### 7.2 Definisi angka

| Angka                    | Rumus                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| **GMV**                  | Total kolom `gmv` dari laporan toko harian                                               |
| **AOV**                  | GMV ÷ pesanan                                                                            |
| **Conversion rate**      | Pesanan ÷ pengunjung (rumus yang sama untuk semua channel)                               |
| **MoM periode setara**   | Tanggal 1–N bulan ini dibanding tanggal 1–N bulan lalu, dengan N = tanggal data terakhir |
| **Seharusnya (MTD)**     | Target × hari berjalan ÷ jumlah hari dalam bulan                                         |
| **Progres**              | GMV bulan berjalan ÷ Seharusnya                                                          |
| **Dibutuhkan / hari**    | (Target − GMV bulan berjalan) ÷ sisa hari                                                |
| **Forecast akhir bulan** | GMV bulan berjalan ÷ hari berjalan × jumlah hari dalam bulan (laju rata-rata)            |

Tanda **"—"** berarti datanya belum ada atau tidak bisa dihitung (misalnya AOV saat pesanan 0). Itu **bukan nol**.

### 7.3 Status target

| Status       | Progres     | Arti praktis                                           |
| ------------ | ----------- | ------------------------------------------------------ |
| **On Track** | ≥ 90%       | Laju penjualan sesuai jalur target                     |
| **Watch**    | 70% – < 90% | Tertinggal; perlu dipantau dan dicari penyebabnya      |
| **At Risk**  | < 70%       | Kemungkinan besar target tidak tercapai tanpa tindakan |

Ambang ini masih menunggu konfirmasi pemilik bisnis dan bisa berubah.

Contoh membaca: Shopee target Rp 345 jt untuk November, data s.d. 10 Nov, GMV Rp 110,5 jt.

- Seharusnya = 345 jt × 10 ÷ 30 = Rp 115 jt.
- Progres = 110,5 ÷ 115 = **96,1% (On Track)**.
- Forecast = 110,5 jt ÷ 10 × 30 = Rp 331,4 jt.
- Untuk tetap mencapai target, dibutuhkan (345 − 110,5) ÷ 20 = **Rp 11,7 jt per hari**.

Baris **Semua channel** hanya menjumlahkan channel yang sudah punya target, supaya channel tanpa target tidak
membuat progres terlihat lebih baik.

### 7.4 Kontribusi SKU internal

Diambil dari laporan **Kinerja Produk Harian** dan dipetakan ke SKU lewat Master Listing.

- **BELUM DIPETAKAN**: GMV dari listing yang belum punya SKU internal. Tetap dihitung di total channel. Petakan
  lewat impor `master_listing` agar masuk ke SKU yang benar.
- Paket (bundle) tampil sebagai SKU-nya sendiri, tidak dipecah ke komponennya.
- Bila total GMV produk berbeda dengan GMV toko, biasanya laporan produk belum diimpor untuk semua hari atau channel.
  Selisihnya ditampilkan di bawah tabel.

## 8. Data DEMO

Organisasi berlabel **DEMO** berisi data sintetis untuk latihan dan pengujian. Banner ungu dan label DEMO selalu
tampil. Jangan gunakan angkanya untuk keputusan bisnis.

## 9. Pertanyaan umum

**Saya sudah mengunggah file, kenapa dashboard masih kosong?**
Batch masih berstatus Tervalidasi. Buka batch dan klik **Simpan ke data e-commerce**.

**Tombol simpan tidak muncul.**
Batch punya baris error, sudah tersimpan, atau dibatalkan. Lihat kotak informasi di halaman batch.

**"Data yang persis sama sudah pernah diimpor."**
File identik sudah ada sebagai batch aktif. Batalkan batch lama bila memang ingin mengulang.

**Google Spreadsheet: "Spreadsheet tidak dapat diakses."**
Atur berbagi ke "Siapa saja yang memiliki link: Pelihat", lalu coba lagi.

**Angka bulan lalu terlihat lebih kecil dari laporan Seller Center.**
Periksa **Hari data** di Ringkasan bulanan. Bila kurang dari jumlah hari kalender, ada laporan harian yang belum
diimpor.

**Saya salah mengimpor angka.**
Perbaiki file, impor ulang periode yang sama, lalu simpan. Data lama ditimpa. Semua penyimpanan tercatat di Audit
Log (siapa, kapan, berapa baris).
