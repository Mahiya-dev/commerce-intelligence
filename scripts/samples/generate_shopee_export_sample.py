"""Synthetic Shopee Seller Center "Performa Produk" export (parentskudetail) for tests and demos.

Same sheet names, headers (36 columns, "Kode Variasi" twice) and id-ID text numbers as the real
export, but DEMO products and invented figures. Never put real exports in the repository.
Usage: python3 -I scripts/samples/generate_shopee_export_sample.py samples/shopee
"""
import sys
from pathlib import Path
import openpyxl

HEAD = ['Kode Produk', 'Produk', 'Status Produk Saat Ini', 'Kode Variasi', 'Nama Variasi', 'Status Variasi Saat Ini',
        'Kode Variasi', 'SKU Induk', 'Total Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)',
        'Jumlah Produk Dilihat', 'Produk Diklik', 'Persentase Klik', 'Tingkat Konversi Pesanan (Pesanan Dibuat)',
        'Tingkat Konversi Pesanan (Pesanan Siap Dikirim)', 'Pesanan Dibuat', 'Pesanan Siap Dikirim',
        'Produk (Pesanan Dibuat)', 'Produk (Pesanan Siap Dikirim)', 'Total Pembeli (Pesanan Dibuat)',
        'Total Pembeli (Pesanan Siap Dikirim)', 'Tingkat Konversi (Pesanan yang Dibuat)',
        'Tingkat Konversi (Pesanan Siap Dikirim)', 'Penjualan per Pesanan (Pesanan Dibuat) (IDR)',
        'Penjualan per Pesanan (Pesanan Siap Dikirim) (IDR)', 'Produk Unik Dilihat', 'Produk Unik Diklik',
        'Pengunjung Produk (Kunjungan)', 'Halaman Produk Dilihat', 'Pengunjung Melihat Tanpa Membeli',
        'Tingkat Pengunjung Melihat Tanpa Membeli', 'Klik Pencarian', 'Suka',
        'Pengunjung Produk (Menambahkan Produk ke Keranjang)', 'Dimasukkan ke Keranjang (Produk)',
        'Tingkat Konversi Produk Dimasukkan ke Keranjang']

def idr(n):
    return f"{n:,}".replace(",", ".")

# (product id, name, status, parent SKU, gmv created, gmv ready, views, clicks, orders c, orders r, units c, units r, visitors)
PRODUCTS = [
    ("DEMO-SP-2001", "Madu Randu Uray 500gr (DEMO)", "Normal", "MU-RANDU-500", 4_250_000, 3_910_000, 21000, 640, 50, 46, 55, 51, 410),
    ("DEMO-SP-2002", "Madu Hutan Uray 1kg (DEMO)", "Normal", "MU-HUTAN-1000", 2_640_000, 2_640_000, 9800, 310, 12, 12, 12, 12, 190),
    ("DEMO-SP-1002", "Madu Kelengkeng Uray 500gr", "Normal", "MU-KLG-500", 1_980_000, 1_650_000, 7400, 220, 12, 10, 12, 10, 150),
    ("DEMO-SP-2003", "Madu Uray Edisi Terbatas (DEMO)", "Normal", "MU-TIDAK-ADA", 1_200_000, 1_150_500, 3100, 95, 5, 5, 6, 6, 70),
    ("DEMO-SP-2004", "Kartu Ucapan Uray (DEMO)", "Diarsipkan", "-", 0, 0, 13, 0, 0, 0, 0, 0, 0),
]

def row(p):
    pid, name, status, sku, gc, gr, views, clicks, oc, orr, uc, ur, vis = p
    pct = lambda a, b: (f"{a / b * 100:.2f}".replace(".", ",") + "%") if b else "0,00%"
    return [pid, name, status, "-", "-", "-", "-", sku, idr(gc), idr(gr), str(views), str(clicks), pct(clicks, views),
            pct(oc, vis), pct(orr, vis), str(oc), str(orr), str(uc), str(ur), str(oc), str(orr), pct(oc, vis),
            pct(orr, vis), idr(gc // oc if oc else 0), idr(gr // orr if orr else 0), str(views // 3),
            str(clicks // 2), str(vis), str(vis * 2), str(vis // 5), "20,00%", str(clicks // 4), "1", str(vis // 2),
            str(vis), "50,00%"]

def main(out_dir: str):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Produk dengan Performa Terbaik"
    ws.append(HEAD)
    for p in PRODUCTS[:4]:
        ws.append(row(p))
    for title in ["Produk yang Baru Ditambahkan", "Harga Belum Kompetitif", "Harga Sudah Kompetitif"]:
        wb.create_sheet(title).append(["Kode Produk", "Produk", "Total Penjualan (Pesanan Dibuat) (IDR)"])
    t = wb.create_sheet("Tingkatkan dengan Iklan")
    t.append(["Kode Produk", "Produk", "Total Penjualan (Pesanan Dibuat) (IDR)"])
    t.append([PRODUCTS[4][0], PRODUCTS[4][1], "0"])
    wb.create_sheet("Iklankan").append(["Kode Produk", "Produk"])
    c = wb.create_sheet("Cek Performa Iklan")
    c.append(HEAD[:2])
    out = Path(out_dir) / "parentskudetail.20261020_20261020.xlsx"
    wb.save(out)
    print(out)

if __name__ == "__main__":
    main(sys.argv[1])
