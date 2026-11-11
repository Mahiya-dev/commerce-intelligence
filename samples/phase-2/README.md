# Sampel Fase 2 — Format Standar Impor & Data DEMO

> Semua angka **SINTETIS (DEMO)**. Bukan hasil bisnis Madu Uray.

| File | Isi |
| --- | --- |
| `Template_Standar_Impor.xlsx` | Petunjuk, Kamus Kolom, dan 4 template kosong (1 baris contoh abu-abu — hapus sebelum unggah) |
| `templates/*.csv` | Template CSV (header saja), UTF-8 |
| `Contoh_Data_DEMO_Sep-Nov2026.xlsx` | Data contoh 1 Sep – 10 Nov 2026 + **Kunci Jawaban** (302 rumus, dapat ditelusuri) |
| `csv/*_DEMO.csv` | Data contoh yang sama, siap diunggah |
| `csv/ERROR_kinerja_toko_harian_DEMO.csv` | File dengan 8 kesalahan disengaja; hasil validasi yang diharapkan ada di Kunci Jawaban §6 |
| `expected.json` | Nilai kunci jawaban dalam format mesin, untuk tes otomatis Fase 2 |

Jenis laporan: `kinerja_toko_harian` (KPI channel), `kinerja_produk_harian` (drilldown listing/SKU),
`target_bulanan`, `master_listing` (pemetaan listing → SKU internal).

Dibuat ulang (deterministik) dengan:

```bash
python3 scripts/samples/generate_phase2_samples.py
```

Kunci Jawaban diverifikasi: 103 nilai dicocokkan dengan perhitungan Python independen, selisih 0.
