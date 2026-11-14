# Contoh ekspor Shopee (sintetis)

`parentskudetail.20261020_20261020.xlsx` meniru struktur ekspor **Performa Produk** Shopee Seller Center (nama
sheet, 36 kolom, angka berformat teks id-ID) dengan produk DEMO dan angka karangan. Dipakai oleh tes
`tests/unit/shopee-export.test.ts` dan `tests/integration/shopee-export.test.ts`.

Dibuat ulang dengan:

```bash
python3 -I scripts/samples/generate_shopee_export_sample.py samples/shopee
```

**Jangan menyimpan ekspor asli toko di repositori.**
