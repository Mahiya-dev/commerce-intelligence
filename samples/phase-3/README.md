# Sampel Fase 3 — Portofolio Produk (DEMO)

> Semua angka **SINTETIS (DEMO)**. Bukan hasil bisnis Madu Uray.

| File | Isi |
| --- | --- |
| `csv/kinerja_toko_harian_HISTORI_DEMO.csv` | Kinerja toko 1 Des 2025 – 31 Agu 2026 (riwayat sebelum data Fase 2) |
| `csv/kinerja_produk_harian_HISTORI_DEMO.csv` | Kinerja 10 listing yang sama, periode yang sama |
| `csv/kinerja_touchpoint_DEMO.csv` | GMV, pesanan, unit dan biaya per listing per touchpoint, 1 Des 2025 – 10 Nov 2026 |
| `templates/kinerja_touchpoint.csv` | Template CSV touchpoint (header saja) |

Bersama `samples/phase-2/csv` (Sep–Nov 2026) data ini membentuk riwayat 12 bulan. Data Fase 2 dan
Kunci Jawabannya **tidak berubah**; riwayat dijangkarkan pada level September 2026.

Konsistensi (diperiksa generator):

- GMV & unit toko = jumlah GMV & unit listing per channel per hari.
- GMV, pesanan & unit touchpoint per listing per hari = baris kinerja produk yang sama.
- `biaya`: iklan = belanja iklan, afiliasi = komisi, live = biaya host/produksi; kosong untuk organik & video.

Cerita per SKU (agar matriks portofolio bergerak): Madu Hutan 500gr besar & stabil (Bintang/Penopang),
Madu Hutan 250gr menyusut (Penopang → Evaluasi), Klanceng 150ml tumbuh cepat lewat TikTok Live (Potensial), Kelengkeng datar, Paket Keluarga melonjak saat
Ramadan, Madu Randu menurun dengan ROAS iklan lemah. Propolis dan Madu Hutan 1kg belum dipetakan.

Dibuat ulang (deterministik): `python3 scripts/samples/generate_phase3_samples.py`

Diimpor ke database DEMO bersama data Fase 2: `npm run db:seed-demo-sales`.
