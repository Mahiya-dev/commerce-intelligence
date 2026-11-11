#!/usr/bin/env python3
"""
Generate Phase 2 sample files (DEMO, synthetic):

  samples/phase-2/Template_Standar_Impor.xlsx      empty standard templates + column dictionary
  samples/phase-2/templates/*.csv                  header-only CSV templates
  samples/phase-2/Contoh_Data_DEMO_Sep-Nov2026.xlsx  sample data + formula-driven answer key
  samples/phase-2/csv/*.csv                        the same sample data as upload-ready CSV
  samples/phase-2/csv/ERROR_kinerja_toko_harian_DEMO.csv  file with deliberate errors

Deterministic (fixed seed) so the files double as Phase 2 test fixtures.
Every number is SYNTHETIC — never present it as actual Madu Uray results.

Usage: python3 scripts/samples/generate_phase2_samples.py [output_dir]
"""
from __future__ import annotations

import calendar
import csv
import json
import math
import random
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

SEED = 20261111
START = date(2026, 9, 1)
CUTOFF = date(2026, 11, 10)  # last complete day of data (11.11 not included)
MISSING = {("tokopedia", date(2026, 10, 17))}  # deliberate gap: "no data" must not become zero

CHANNELS = ["shopee", "tiktok_shop", "tokopedia"]
CHANNEL_BASE_GMV = {"shopee": 9_500_000, "tiktok_shop": 6_500_000, "tokopedia": 2_800_000}
CHANNEL_GROWTH = {  # month multiplier relative to September
    "shopee": {9: 1.00, 10: 1.06, 11: 1.10},
    "tiktok_shop": {9: 1.00, 10: 1.10, 11: 1.21},
    "tokopedia": {9: 1.00, 10: 0.98, 11: 0.95},
}
CHANNEL_CR = {"shopee": (0.022, 0.035), "tiktok_shop": (0.012, 0.022), "tokopedia": (0.018, 0.030)}
WEEKDAY = [1.00, 0.97, 0.98, 1.00, 1.05, 1.12, 1.08]  # Mon..Sun


@dataclass(frozen=True)
class Listing:
    channel: str
    product_id: str
    sku_id: str  # "" = channel has no SKU-level id
    name: str
    price: int
    weight: float
    sku_internal: str  # "" = not mapped yet
    units_per_listing: int


# Matches the DEMO master data seeded in Phase 1 (src/lib/master-data/demo-seed.ts).
LISTINGS = [
    Listing("shopee", "DEMO-SP-1001", "DEMO-SP-1001-A", "Madu Hutan Asli Uray 250gr", 65_000, 0.15, "MU-HUTAN-250", 1),
    Listing("shopee", "DEMO-SP-1001", "DEMO-SP-1001-B", "Madu Hutan Asli Uray 500gr", 115_000, 0.35, "MU-HUTAN-500", 1),
    Listing("shopee", "DEMO-SP-1002", "", "Madu Kelengkeng Uray 500gr", 130_000, 0.20, "MU-KLG-500", 1),
    Listing("shopee", "DEMO-SP-1003", "", "Paket Keluarga Sehat Madu Uray", 290_000, 0.15, "MU-PKT-KLG-01", 1),
    Listing("shopee", "DEMO-SP-1004", "", "Madu Hutan 500gr Isi 2 (Hemat)", 220_000, 0.15, "MU-HUTAN-500", 2),
    Listing("tiktok_shop", "DEMO-TT-2001", "DEMO-TT-2001-1", "Madu Hutan Uray 500 gram ORIGINAL", 115_000, 0.50, "MU-HUTAN-500", 1),
    Listing("tiktok_shop", "DEMO-TT-2002", "", "Madu Klanceng Trigona 150ml", 105_000, 0.25, "MU-KLC-150", 1),
    Listing("tiktok_shop", "DEMO-TT-2003", "", "Propolis Uray Daya Tahan Tubuh", 55_000, 0.25, "", 1),
    Listing("tokopedia", "DEMO-TP-3001", "", "Madu Randu Murni Uray 500g", 90_000, 0.40, "MU-RANDU-500", 1),
    Listing("tokopedia", "DEMO-TP-3002", "", "Madu Hutan Uray 1kg", 210_000, 0.60, "", 1),
]

# DEMO target-setting: target = forecast / ratio, so November lands on a known status.
TARGET_RATIO = {
    9: {"shopee": 0.96, "tiktok_shop": 0.93, "tokopedia": 0.88},
    10: {"shopee": 1.02, "tiktok_shop": 0.95, "tokopedia": 0.84},
    11: {"shopee": 0.97, "tiktok_shop": 0.85, "tokopedia": 0.62},  # On Track / gap 80–90 / At Risk
}

UNMAPPED = "BELUM DIPETAKAN"


def day_multiplier(d: date) -> float:
    m = WEEKDAY[d.weekday()]
    if d.day >= 25 or d.day <= 3:
        m *= 1.15  # payday
    if d.month == d.day:  # 9.9, 10.10, 11.11
        m *= 3.0
    elif d.month == d.day + 1 or (d.day == d.month - 1):
        m *= 1.3  # day before twin-date campaign
    return m


def poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam > 60:  # normal approximation for large lambda
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def round100(x: float) -> int:
    return int(round(x / 100.0)) * 100


def generate():
    rng = random.Random(SEED)
    product_rows, shop_rows = [], []
    d = START
    while d <= CUTOFF:
        for ch in CHANNELS:
            if (ch, d) in MISSING:
                continue
            day_gmv = CHANNEL_BASE_GMV[ch] * CHANNEL_GROWTH[ch][d.month] * day_multiplier(d)
            discount = rng.uniform(0.10, 0.18) if d.month == d.day else rng.uniform(0.0, 0.08)
            sums = {"gmv": 0, "orders": 0, "units": 0, "visitors": 0, "cancel": 0, "gmv_cancel": 0}
            for lst in (x for x in LISTINGS if x.channel == ch):
                expected = day_gmv * lst.weight
                orders = poisson(rng, expected / (lst.price * 1.1))
                multi = sum(1 for _ in range(orders) if rng.random() < 0.1)
                units = orders + multi
                gmv = round100(units * lst.price * (1 - discount))
                cancel = sum(1 for _ in range(orders) if rng.random() < 0.03)
                gmv_cancel = round100(gmv * cancel / orders) if orders else 0
                cr = rng.uniform(*CHANNEL_CR[ch])
                visitors = math.ceil(orders / cr) if orders else rng.randint(20, 60)
                clicks = math.ceil(visitors * rng.uniform(1.25, 1.75))
                product_rows.append(
                    {
                        "tanggal": d,
                        "channel": ch,
                        "id_produk_channel": lst.product_id,
                        "id_sku_channel": lst.sku_id,
                        "nama_listing": lst.name,
                        "gmv": gmv,
                        "pesanan": orders,
                        "unit_terjual": units,
                        "pengunjung_produk": visitors,
                        "klik_produk": clicks,
                        "pesanan_batal": cancel,
                    }
                )
                sums["gmv"] += gmv
                sums["orders"] += orders
                sums["units"] += units
                sums["visitors"] += visitors
                sums["cancel"] += cancel
                sums["gmv_cancel"] += gmv_cancel
            shop_orders = max(round(sums["orders"] * 0.93), 0)
            shop_rows.append(
                {
                    "tanggal": d,
                    "channel": ch,
                    "gmv": sums["gmv"],
                    "pesanan": shop_orders,
                    "unit_terjual": sums["units"],
                    "pengunjung": round(sums["visitors"] * 0.78),
                    "pembeli": round(shop_orders * 0.97),
                    "pesanan_batal": round(sums["cancel"] * 0.93),
                    "gmv_batal": sums["gmv_cancel"],
                    "gmv_retur": None,  # optional column left blank = "not available", NOT zero
                }
            )
        d += timedelta(days=1)
    return shop_rows, product_rows


def build_targets(shop_rows):
    targets = []
    for month in (9, 10, 11):
        days_in_month = calendar.monthrange(2026, month)[1]
        for ch in CHANNELS:
            rows = [r for r in shop_rows if r["channel"] == ch and r["tanggal"].month == month]
            gmv = sum(r["gmv"] for r in rows)
            orders = sum(r["pesanan"] for r in rows)
            days = CUTOFF.day if month == CUTOFF.month else days_in_month
            forecast_gmv = gmv / days * days_in_month
            forecast_orders = orders / days * days_in_month
            ratio = TARGET_RATIO[month][ch]
            targets.append(
                {
                    "bulan": f"2026-{month:02d}",
                    "channel": ch,
                    "target_gmv": int(math.ceil(forecast_gmv / ratio / 5_000_000) * 5_000_000),
                    "target_pesanan": int(math.ceil(forecast_orders / ratio / 50) * 50),
                    "catatan": "DEMO",
                }
            )
    return targets


# ---------------------------------------------------------------------------
# Column dictionary (single source for templates, CSV headers and docs)
# ---------------------------------------------------------------------------
TEMPLATES = {
    "kinerja_toko_harian": {
        "title": "Kinerja Toko Harian (per channel per hari)",
        "purpose": "Sumber KPI channel: GMV, Pesanan, AOV, Conversion Rate, Unit, Pengunjung. Satu baris = satu channel pada satu tanggal.",
        "key": "tanggal + channel",
        "columns": [
            ("tanggal", "Wajib", "Tanggal", "YYYY-MM-DD", "2026-11-10", "Tanggal PEMBAYARAN pesanan (basis pesanan dibayar), zona waktu WIB."),
            ("channel", "Wajib", "Teks", "shopee | tiktok_shop | tokopedia", "shopee", "Kode channel, huruf kecil."),
            ("gmv", "Wajib", "Angka (Rp)", "Bilangan bulat, tanpa 'Rp', titik atau koma", "12500000", "GMV pesanan dibayar sesuai Seller Center, sudah termasuk diskon/voucher sebagaimana dihitung platform, TERMASUK pesanan yang kemudian dibatalkan. Data operasional — BUKAN revenue P&L."),
            ("pesanan", "Wajib", "Bilangan bulat", "≥ 0", "96", "Jumlah pesanan dibayar (unik per pesanan)."),
            ("unit_terjual", "Wajib", "Bilangan bulat", "≥ 0", "108", "Jumlah unit listing terjual."),
            ("pengunjung", "Wajib", "Bilangan bulat", "≥ 0", "3850", "Pengunjung unik toko. Dipakai untuk Conversion Rate = pesanan ÷ pengunjung."),
            ("pembeli", "Opsional", "Bilangan bulat", "≥ 0", "93", "Pembeli unik."),
            ("pesanan_batal", "Opsional", "Bilangan bulat", "≥ 0", "3", "Pesanan dibayar yang kemudian dibatalkan."),
            ("gmv_batal", "Opsional", "Angka (Rp)", "Bilangan bulat", "390000", "GMV dari pesanan_batal. Bagian dari gmv (sudah termasuk di dalamnya), hanya informasi."),
            ("gmv_retur", "Opsional", "Angka (Rp)", "Bilangan bulat", "", "GMV yang direfund/diretur. Kosong = data tidak tersedia (bukan nol)."),
        ],
    },
    "kinerja_produk_harian": {
        "title": "Kinerja Produk Harian (per listing per hari)",
        "purpose": "Drilldown produk/SKU. Satu baris = satu listing (ID produk + ID SKU channel) pada satu tanggal. "
        "Catatan: pesanan per produk TIDAK boleh dijumlahkan menjadi pesanan toko (satu pesanan bisa berisi beberapa produk).",
        "key": "tanggal + channel + id_produk_channel + id_sku_channel",
        "columns": [
            ("tanggal", "Wajib", "Tanggal", "YYYY-MM-DD", "2026-11-10", "Tanggal pembayaran pesanan, WIB."),
            ("channel", "Wajib", "Teks", "shopee | tiktok_shop | tokopedia", "shopee", "Kode channel."),
            ("id_produk_channel", "Wajib", "Teks", "Persis seperti di Seller Center", "DEMO-SP-1001", "ID produk/listing di marketplace. Simpan sebagai teks agar angka panjang tidak berubah."),
            ("id_sku_channel", "Opsional", "Teks", "Kosongkan bila listing tanpa variasi", "DEMO-SP-1001-B", "ID variasi/SKU di marketplace."),
            ("nama_listing", "Wajib", "Teks", "", "Madu Hutan Asli Uray 500gr", "Nama listing (informasi; pemetaan memakai ID)."),
            ("gmv", "Wajib", "Angka (Rp)", "Bilangan bulat", "4370000", "GMV listing (definisi sama dengan kinerja toko)."),
            ("pesanan", "Wajib", "Bilangan bulat", "≥ 0", "38", "Pesanan yang memuat listing ini."),
            ("unit_terjual", "Wajib", "Bilangan bulat", "≥ 0", "41", "Unit LISTING terjual. Unit SKU internal = unit_terjual × isi_per_listing."),
            ("pengunjung_produk", "Opsional", "Bilangan bulat", "≥ 0", "1420", "Pengunjung unik halaman produk."),
            ("klik_produk", "Opsional", "Bilangan bulat", "≥ 0", "2210", "Klik/tayangan halaman produk sesuai metrik Seller Center."),
            ("pesanan_batal", "Opsional", "Bilangan bulat", "≥ 0", "1", "Pesanan listing ini yang dibatalkan."),
        ],
    },
    "target_bulanan": {
        "title": "Target Bulanan (per channel)",
        "purpose": "Target GMV per channel per bulan. Total target = jumlah target channel.",
        "key": "bulan + channel",
        "columns": [
            ("bulan", "Wajib", "Teks", "YYYY-MM", "2026-11", "Bulan target."),
            ("channel", "Wajib", "Teks", "shopee | tiktok_shop | tokopedia", "shopee", "Kode channel."),
            ("target_gmv", "Wajib", "Angka (Rp)", "Bilangan bulat > 0", "350000000", "Target GMV bulanan."),
            ("target_pesanan", "Opsional", "Bilangan bulat", "> 0", "3000", "Target jumlah pesanan."),
            ("catatan", "Opsional", "Teks", "", "Disetujui 2026-10-28", "Catatan/versi target."),
        ],
    },
    "master_listing": {
        "title": "Master Listing (pemetaan listing → SKU internal)",
        "purpose": "Menghubungkan listing marketplace ke SKU internal. Listing tanpa sku_internal tetap diimpor dan ditandai 'Belum dipetakan'.",
        "key": "channel + id_produk_channel + id_sku_channel",
        "columns": [
            ("channel", "Wajib", "Teks", "shopee | tiktok_shop | tokopedia", "shopee", "Kode channel."),
            ("id_produk_channel", "Wajib", "Teks", "Persis seperti di Seller Center", "DEMO-SP-1004", "ID produk/listing."),
            ("id_sku_channel", "Opsional", "Teks", "", "", "ID variasi/SKU (kosong bila tanpa variasi)."),
            ("nama_listing", "Wajib", "Teks", "", "Madu Hutan 500gr Isi 2 (Hemat)", "Nama listing."),
            ("sku_internal", "Opsional", "Teks", "SKU dari Master Produk", "MU-HUTAN-500", "SKU internal. Kosong = belum dipetakan."),
            ("isi_per_listing", "Wajib", "Bilangan bulat", "≥ 1", "2", "Jumlah unit SKU internal dalam 1 unit listing (mis. 'Isi 2' = 2)."),
        ],
    },
}

# ---------------------------------------------------------------------------
# Styling
# ---------------------------------------------------------------------------
FONT = "Arial"
F_BASE = Font(name=FONT, size=10)
F_BOLD = Font(name=FONT, size=10, bold=True)
F_HEAD = Font(name=FONT, size=10, bold=True, color="FFFFFF")
F_TITLE = Font(name=FONT, size=14, bold=True)
F_SUB = Font(name=FONT, size=11, bold=True)
F_NOTE = Font(name=FONT, size=9, italic=True, color="595959")
F_EXAMPLE = Font(name=FONT, size=10, italic=True, color="808080")
F_INPUT = Font(name=FONT, size=10, color="0000FF")
F_LINK = Font(name=FONT, size=10, color="008000")
F_DEMO = Font(name=FONT, size=10, bold=True, color="7030A0")
FILL_HEAD = PatternFill("solid", fgColor="8A4B0F")  # honey brown
FILL_REQ = PatternFill("solid", fgColor="B5651D")
FILL_INPUT = PatternFill("solid", fgColor="FFFF00")
FILL_SECTION = PatternFill("solid", fgColor="F3E9DC")
FILL_DEMO = PatternFill("solid", fgColor="EDE1F5")
THIN = Side(style="thin", color="D9D9D9")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
NUM = "#,##0;(#,##0);-"
PCT = "0.0%;(0.0%);-"
DATE_FMT = "yyyy-mm-dd"


def style_header(ws, row, ncols, required_flags=None):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = F_HEAD
        cell.fill = FILL_REQ if required_flags and required_flags[c - 1] else FILL_HEAD
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER


def set_widths(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def apply_font(ws):
    for row in ws.iter_rows():
        for cell in row:
            if cell.font is None or cell.font.name != FONT:
                cell.font = Font(name=FONT, size=cell.font.size if cell.font and cell.font.size else 10,
                                 bold=cell.font.bold if cell.font else False,
                                 italic=cell.font.italic if cell.font else False,
                                 color=cell.font.color if cell.font else None)


def write_column_dictionary(ws, start_row=1):
    r = start_row
    ws.cell(row=r, column=1, value="Kamus Kolom — format standar impor").font = F_TITLE
    r += 1
    ws.cell(row=r, column=1, value="Nama kolom harus persis sama (huruf kecil, garis bawah). Urutan kolom bebas; kolom tambahan diabaikan dengan peringatan.").font = F_NOTE
    r += 2
    for key, spec in TEMPLATES.items():
        ws.cell(row=r, column=1, value=f"{key}  —  {spec['title']}").font = F_SUB
        ws.cell(row=r, column=1).fill = FILL_SECTION
        for c in range(2, 7):
            ws.cell(row=r, column=c).fill = FILL_SECTION
        r += 1
        ws.cell(row=r, column=1, value=spec["purpose"]).font = F_NOTE
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
        ws.cell(row=r, column=1).alignment = WRAP
        ws.row_dimensions[r].height = 28
        r += 1
        ws.cell(row=r, column=1, value=f"Kunci unik baris (dipakai untuk deteksi duplikat & update idempoten): {spec['key']}").font = F_NOTE
        r += 1
        headers = ["Kolom", "Wajib/Opsional", "Tipe", "Format / Nilai", "Contoh", "Definisi"]
        for c, h in enumerate(headers, start=1):
            ws.cell(row=r, column=c, value=h)
        style_header(ws, r, len(headers))
        r += 1
        for col in spec["columns"]:
            for c, v in enumerate(col, start=1):
                cell = ws.cell(row=r, column=c, value=v)
                cell.font = F_BOLD if c == 1 else F_BASE
                cell.alignment = WRAP
                cell.border = BORDER
            r += 1
        r += 1
    set_widths(ws, [22, 14, 16, 30, 26, 70])


# ---------------------------------------------------------------------------
# Template workbook
# ---------------------------------------------------------------------------
def build_template_workbook(path: Path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Petunjuk"
    lines = [
        ("Template Standar Impor — Uray Commerce Intelligence", F_TITLE),
        ("Versi format: v1 (Fase 2) · Diisi oleh: Analyst · Diunggah via menu Impor Data", F_NOTE),
        ("", F_BASE),
        ("Cara mengisi", F_SUB),
        ("1. Gunakan satu sheet/file per jenis laporan. Nama sheet atau nama file CSV = jenis laporan (mis. kinerja_toko_harian).", F_BASE),
        ("2. Baris 1 = nama kolom (JANGAN diubah). Isi data mulai baris 2. Hapus baris contoh (abu-abu miring) sebelum mengunggah.", F_BASE),
        ("3. Kolom berwarna oranye tua = WAJIB. Kolom coklat = opsional (boleh dikosongkan).", F_BASE),
        ("4. Tanggal: format YYYY-MM-DD (mis. 2026-11-10) atau sel tanggal Excel. Basis tanggal = tanggal PEMBAYARAN pesanan.", F_BASE),
        ("5. Angka: tanpa 'Rp', tanpa titik/koma ribuan, tanpa singkatan (bukan '1,2jt'). Contoh benar: 1200000.", F_BASE),
        ("6. Kosong ≠ nol. Kosongkan sel bila data tidak tersedia; isi 0 hanya bila nilainya memang nol.", F_BASE),
        ("7. Simpan ID marketplace sebagai TEKS agar ID panjang tidak berubah menjadi notasi ilmiah.", F_BASE),
        ("8. Mengunggah ulang periode yang sama akan MEMPERBARUI data (idempoten), bukan menggandakan. File yang persis sama ditolak.", F_BASE),
        ("", F_BASE),
        ("Keputusan bisnis yang tercermin di format ini", F_SUB),
        ("• GMV = nilai pesanan dibayar menurut Seller Center (sudah termasuk diskon/voucher sebagaimana dihitung platform).", F_BASE),
        ("• Data Seller Center dipakai untuk optimasi e-commerce & strategi iklan saja. Revenue P&L memakai final revenue dari keuangan.", F_BASE),
        ("• Basis tanggal = tanggal pesanan DIBAYAR.", F_BASE),
        ("", F_BASE),
        ("Sheet di file ini", F_SUB),
        ("Kamus Kolom — definisi setiap kolom · kinerja_toko_harian · kinerja_produk_harian · target_bulanan · master_listing", F_BASE),
    ]
    for i, (text, font) in enumerate(lines, start=1):
        ws.cell(row=i, column=1, value=text).font = font
    ws.column_dimensions["A"].width = 130

    write_column_dictionary(wb.create_sheet("Kamus Kolom"))

    for key, spec in TEMPLATES.items():
        sh = wb.create_sheet(key)
        cols = spec["columns"]
        for c, col in enumerate(cols, start=1):
            sh.cell(row=1, column=c, value=col[0])
            ex = col[4]
            cell = sh.cell(row=2, column=c, value=(int(ex) if ex.isdigit() and col[2].startswith(("Angka", "Bilangan")) else ex))
            cell.font = F_EXAMPLE
            if col[2] == "Teks":
                cell.number_format = "@"
        style_header(sh, 1, len(cols), [col[1] == "Wajib" for col in cols])
        for c, col in enumerate(cols, start=1):
            sh.cell(row=1, column=c).comment = Comment(f"{col[1]} · {col[2]}\n{col[5]}", "UCI")
        sh.cell(row=2, column=1).comment = Comment("Baris 2 = CONTOH format. Hapus sebelum mengunggah.", "UCI")
        # Text columns keep IDs as text for the first 2000 data rows
        for c, col in enumerate(cols, start=1):
            if col[2] == "Teks":
                for r in range(3, 2002):
                    sh.cell(row=r, column=c).number_format = "@"
        sh.freeze_panes = "A2"
        set_widths(sh, [max(14, min(34, len(col[0]) + 6)) for col in cols])
    for sheet in wb.worksheets:
        apply_font(sheet)
    wb.save(path)


def write_csv_templates(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    for key, spec in TEMPLATES.items():
        with open(out / f"{key}.csv", "w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f).writerow([c[0] for c in spec["columns"]])


# ---------------------------------------------------------------------------
# Sample data workbook with formula-driven answer key
# ---------------------------------------------------------------------------
def write_data_sheet(wb, key, rows):
    sh = wb.create_sheet(key)
    cols = [c[0] for c in TEMPLATES[key]["columns"]]
    for c, name in enumerate(cols, start=1):
        sh.cell(row=1, column=c, value=name)
    style_header(sh, 1, len(cols), [c[1] == "Wajib" for c in TEMPLATES[key]["columns"]])
    for r, row in enumerate(rows, start=2):
        for c, name in enumerate(cols, start=1):
            v = row.get(name)
            cell = sh.cell(row=r, column=c, value=v)
            cell.font = F_BASE
            if isinstance(v, date):
                cell.number_format = DATE_FMT
            elif name in ("gmv", "gmv_batal", "gmv_retur", "target_gmv"):
                cell.number_format = "#,##0"
            elif TEMPLATES[key]["columns"][c - 1][2] == "Teks":
                cell.number_format = "@"
    sh.freeze_panes = "A2"
    set_widths(sh, [max(13, min(34, len(n) + 6)) for n in cols])
    return sh, len(rows) + 1  # last data row


def build_sample_workbook(path: Path, shop_rows, product_rows, targets, error_spec):
    wb = Workbook()
    readme = wb.active
    readme.title = "README"
    _, shop_last = write_data_sheet(wb, "kinerja_toko_harian", shop_rows)
    _, prod_last = write_data_sheet(wb, "kinerja_produk_harian", product_rows)
    _, tgt_last = write_data_sheet(wb, "target_bulanan", targets)
    master_rows = [
        {
            "channel": l.channel,
            "id_produk_channel": l.product_id,
            "id_sku_channel": l.sku_id,
            "nama_listing": l.name,
            "sku_internal": l.sku_internal,
            "isi_per_listing": l.units_per_listing,
        }
        for l in LISTINGS
    ]
    _, mst_last = write_data_sheet(wb, "master_listing", master_rows)

    S = "kinerja_toko_harian"
    P = "kinerja_produk_harian"
    T = "target_bulanan"
    M = "master_listing"

    def rng(sheet, col, last):
        return f"{sheet}!${col}$2:${col}${last}"

    s_date, s_ch = rng(S, "A", shop_last), rng(S, "B", shop_last)
    s_gmv, s_ord, s_unit, s_vis = rng(S, "C", shop_last), rng(S, "D", shop_last), rng(S, "E", shop_last), rng(S, "F", shop_last)
    s_cancel, s_gcancel = rng(S, "H", shop_last), rng(S, "I", shop_last)
    p_date, p_ch, p_pid, p_sid = rng(P, "A", prod_last), rng(P, "B", prod_last), rng(P, "C", prod_last), rng(P, "D", prod_last)
    p_gmv, p_unit = rng(P, "F", prod_last), rng(P, "H", prod_last)
    t_month, t_ch, t_gmv = rng(T, "A", tgt_last), rng(T, "B", tgt_last), rng(T, "C", tgt_last)
    m_ch, m_pid, m_sid, m_sku, m_isi = (rng(M, c, mst_last) for c in "ABCEF")

    ws = wb.create_sheet("Kunci Jawaban")
    ws.sheet_properties.tabColor = "7030A0"
    ws["A1"] = "Kunci Jawaban — hasil yang HARUS ditampilkan aplikasi untuk data DEMO ini"
    ws["A1"].font = F_TITLE
    ws["A2"] = "Semua angka dihitung dengan rumus dari sheet data (SUMIFS/COUNTIFS) dan dapat ditelusuri. DATA SINTETIS — bukan hasil bisnis Madu Uray."
    ws["A2"].font = F_DEMO
    ws["A3"] = "Sel kuning = asumsi/parameter yang bisa diubah. Teks biru = input; hitam = rumus."
    ws["A3"].font = F_NOTE

    # --- Parameters
    ws["A5"] = "Parameter"
    ws["A5"].font = F_SUB
    params = [
        ("Tanggal cut-off (hari lengkap terakhir)", CUTOFF, DATE_FMT, "Data sampai 10 Nov 2026; hari berjalan (11 Nov) tidak dihitung karena belum lengkap."),
        ("Hari dalam bulan berjalan", "=DAY(EOMONTH(B6,0))", "0", None),
        ("Hari berjalan (s.d. cut-off)", "=DAY(B6)", "0", None),
        ("Ambang On Track (progres ≥)", 0.9, "0%", "Dari keputusan Anda: di atas 90% = On Track."),
        ("Ambang Watch (progres ≥)", 0.7, "0%", "INTERPRETASI: 70%–<90% = Watch, <70% = At Risk. Jawaban Anda menyebut 'di bawah 80 watch, di bawah 70 at risk' sehingga rentang 80–90% belum terdefinisi — mohon konfirmasi."),
    ]
    for i, (label, value, fmt, note) in enumerate(params, start=6):
        ws.cell(row=i, column=1, value=label).font = F_BASE
        cell = ws.cell(row=i, column=2, value=value)
        cell.number_format = fmt
        if not (isinstance(value, str) and value.startswith("=")):
            cell.font = F_INPUT
            cell.fill = FILL_INPUT
        else:
            cell.font = F_BASE
        if note:
            ws.cell(row=i, column=3, value=note).font = F_NOTE
    CUT, DIM, ELAPSED, ON_TRACK, WATCH = "$B$6", "$B$7", "$B$8", "$B$9", "$B$10"

    # --- Section 1: monthly summary per channel
    r = 12
    ws.cell(row=r, column=1, value="1. Ringkasan bulanan per channel (sumber: kinerja_toko_harian)").font = F_SUB
    r += 1
    h1 = ["Bulan", "Channel", "Mulai", "Akhir", "Hari periode", "Hari dengan data", "Kelengkapan data",
          "GMV (Rp)", "Pesanan", "AOV (Rp)", "Unit terjual", "Pengunjung", "Conversion Rate", "Pesanan batal", "GMV batal (Rp)"]
    for c, h in enumerate(h1, start=1):
        ws.cell(row=r, column=c, value=h)
    style_header(ws, r, len(h1))
    r += 1
    periods = [("Sep 2026", date(2026, 9, 1), date(2026, 9, 30)),
               ("Okt 2026", date(2026, 10, 1), date(2026, 10, 31)),
               ("Nov 2026 (MTD)", date(2026, 11, 1), None)]
    sec1_rows = {}
    for label, start, end in periods:
        for ch in CHANNELS + ["SEMUA"]:
            ws.cell(row=r, column=1, value=label)
            ws.cell(row=r, column=2, value=ch)
            ws.cell(row=r, column=3, value=start).number_format = DATE_FMT
            if end:
                ws.cell(row=r, column=4, value=end).number_format = DATE_FMT
            else:
                ws.cell(row=r, column=4, value=f"={CUT}").number_format = DATE_FMT
            for c in (1, 2, 3):
                ws.cell(row=r, column=c).font = F_INPUT
            if end:
                ws.cell(row=r, column=4).font = F_INPUT
            crit = f'{s_date},">="&$C{r},{s_date},"<="&$D{r}'
            chcrit = f",{s_ch},$B{r}" if ch != "SEMUA" else ""
            ws.cell(row=r, column=5, value=f"=$D{r}-$C{r}+1")
            if ch != "SEMUA":
                ws.cell(row=r, column=6, value=f"=COUNTIFS({crit}{chcrit})")
                ws.cell(row=r, column=7, value=f'=IF(F{r}=E{r},"Lengkap","TIDAK LENGKAP: "&(E{r}-F{r})&" hari tanpa data")')
            else:
                first = r - 3
                ws.cell(row=r, column=6, value=f"=SUM(F{first}:F{r - 1})")
                ws.cell(row=r, column=7, value=f'=IF(F{r}=E{r}*3,"Lengkap","TIDAK LENGKAP: "&(E{r}*3-F{r})&" channel-hari tanpa data")')
            for c, col in ((8, s_gmv), (9, s_ord), (11, s_unit), (12, s_vis), (14, s_cancel), (15, s_gcancel)):
                ws.cell(row=r, column=c, value=f"=SUMIFS({col},{crit}{chcrit})")
            ws.cell(row=r, column=10, value=f'=IF(I{r}=0,"",H{r}/I{r})')
            ws.cell(row=r, column=13, value=f'=IF(L{r}=0,"",I{r}/L{r})')
            for c in (5, 6, 8, 9, 10, 11, 12, 14, 15):
                ws.cell(row=r, column=c).number_format = NUM
            ws.cell(row=r, column=13).number_format = "0.00%"
            if ch == "SEMUA":
                for c in range(1, 16):
                    ws.cell(row=r, column=c).font = F_BOLD
            sec1_rows[(label, ch)] = r
            r += 1
    ws.cell(row=r, column=1, value="AOV = GMV ÷ Pesanan. Conversion Rate = Pesanan ÷ Pengunjung (rumus sama untuk semua channel). "
            "Hari tanpa data ditandai, BUKAN dihitung sebagai penjualan nol.").font = F_NOTE
    r += 2

    # --- Section 2: MoM equivalent period
    ws.cell(row=r, column=1, value="2. MoM periode setara: 1–N bulan ini vs 1–N bulan lalu (N = hari berjalan)").font = F_SUB
    r += 1
    ws.cell(row=r, column=1, value="Periode bulan ini")
    ws.cell(row=r, column=2, value=f"=DATE(YEAR({CUT}),MONTH({CUT}),1)").number_format = DATE_FMT
    ws.cell(row=r, column=3, value=f"={CUT}").number_format = DATE_FMT
    cur_r = r
    r += 1
    ws.cell(row=r, column=1, value="Periode setara bulan lalu")
    ws.cell(row=r, column=2, value=f"=EDATE(B{cur_r},-1)").number_format = DATE_FMT
    ws.cell(row=r, column=3, value=f"=MIN(EDATE({CUT},-1),EOMONTH(B{r},0))").number_format = DATE_FMT
    prev_r = r
    ws.cell(row=r, column=4, value="Bila bulan lalu lebih pendek, akhir periode dipotong ke hari terakhir bulan lalu.").font = F_NOTE
    r += 1
    h2 = ["Channel", "GMV bulan ini (Rp)", "GMV bulan lalu (Rp)", "Δ GMV MoM", "Pesanan bulan ini", "Pesanan bulan lalu", "Δ Pesanan MoM", "AOV bulan ini (Rp)", "AOV bulan lalu (Rp)", "Δ AOV MoM"]
    for c, h in enumerate(h2, start=1):
        ws.cell(row=r, column=c, value=h)
    style_header(ws, r, len(h2))
    r += 1
    sec2_rows = {}
    for ch in CHANNELS + ["SEMUA"]:
        ws.cell(row=r, column=1, value=ch).font = F_INPUT if ch != "SEMUA" else F_BOLD
        chcrit = f",{s_ch},$A{r}" if ch != "SEMUA" else ""
        cur = f'{s_date},">="&$B${cur_r},{s_date},"<="&$C${cur_r}{chcrit}'
        prv = f'{s_date},">="&$B${prev_r},{s_date},"<="&$C${prev_r}{chcrit}'
        ws.cell(row=r, column=2, value=f"=SUMIFS({s_gmv},{cur})")
        ws.cell(row=r, column=3, value=f"=SUMIFS({s_gmv},{prv})")
        ws.cell(row=r, column=4, value=f'=IF(C{r}=0,"",B{r}/C{r}-1)')
        ws.cell(row=r, column=5, value=f"=SUMIFS({s_ord},{cur})")
        ws.cell(row=r, column=6, value=f"=SUMIFS({s_ord},{prv})")
        ws.cell(row=r, column=7, value=f'=IF(F{r}=0,"",E{r}/F{r}-1)')
        ws.cell(row=r, column=8, value=f'=IF(E{r}=0,"",B{r}/E{r})')
        ws.cell(row=r, column=9, value=f'=IF(F{r}=0,"",C{r}/F{r})')
        ws.cell(row=r, column=10, value=f'=IF(OR(H{r}="",I{r}=""),"",H{r}/I{r}-1)')
        for c in (2, 3, 5, 6, 8, 9):
            ws.cell(row=r, column=c).number_format = NUM
        for c in (4, 7, 10):
            ws.cell(row=r, column=c).number_format = PCT
        if ch == "SEMUA":
            for c in range(1, 11):
                ws.cell(row=r, column=c).font = F_BOLD
        sec2_rows[ch] = r
        r += 1
    r += 1

    # --- Section 3: target, expected progress, status, forecast, run rate
    ws.cell(row=r, column=1, value="3. Target bulan berjalan: progres, status, forecast & run rate").font = F_SUB
    r += 1
    ws.cell(row=r, column=1, value="Bulan target")
    ws.cell(row=r, column=2, value=f'=TEXT({CUT},"yyyy-mm")')
    month_r = r
    r += 1
    h3 = ["Channel", "Target GMV (Rp)", "GMV MTD (Rp)", "Expected MTD (Rp)", "Progres vs expected", "Status",
          "Pencapaian target", "Run rate aktual / hari (Rp)", "Run rate dibutuhkan / hari (Rp)", "Forecast akhir bulan (Rp)", "Forecast vs target"]
    for c, h in enumerate(h3, start=1):
        ws.cell(row=r, column=c, value=h)
    style_header(ws, r, len(h3))
    r += 1
    sec3_rows = {}
    first3 = r
    for ch in CHANNELS + ["SEMUA"]:
        ws.cell(row=r, column=1, value=ch).font = F_INPUT if ch != "SEMUA" else F_BOLD
        if ch != "SEMUA":
            ws.cell(row=r, column=2, value=f"=SUMIFS({t_gmv},{t_month},$B${month_r},{t_ch},$A{r})")
            ws.cell(row=r, column=3, value=f'=SUMIFS({s_gmv},{s_ch},$A{r},{s_date},">="&DATE(YEAR({CUT}),MONTH({CUT}),1),{s_date},"<="&{CUT})')
        else:
            ws.cell(row=r, column=2, value=f"=SUM(B{first3}:B{r - 1})")
            ws.cell(row=r, column=3, value=f"=SUM(C{first3}:C{r - 1})")
        ws.cell(row=r, column=4, value=f"=B{r}*{ELAPSED}/{DIM}")
        ws.cell(row=r, column=5, value=f'=IF(D{r}=0,"",C{r}/D{r})')
        ws.cell(row=r, column=6, value=f'=IF(E{r}="","",IF(E{r}>={ON_TRACK},"On Track",IF(E{r}>={WATCH},"Watch","At Risk")))')
        ws.cell(row=r, column=7, value=f'=IF(B{r}=0,"",C{r}/B{r})')
        ws.cell(row=r, column=8, value=f"=C{r}/{ELAPSED}")
        ws.cell(row=r, column=9, value=f"=IF({DIM}-{ELAPSED}=0,0,MAX(0,(B{r}-C{r})/({DIM}-{ELAPSED})))")
        ws.cell(row=r, column=10, value=f"=H{r}*{DIM}")
        ws.cell(row=r, column=11, value=f'=IF(B{r}=0,"",J{r}/B{r})')
        for c in (2, 3, 4, 8, 9, 10):
            ws.cell(row=r, column=c).number_format = NUM
        for c in (5, 7, 11):
            ws.cell(row=r, column=c).number_format = PCT
        if ch == "SEMUA":
            for c in range(1, 12):
                ws.cell(row=r, column=c).font = F_BOLD
        sec3_rows[ch] = r
        r += 1
    notes3 = [
        "Expected MTD = Target × hari berjalan ÷ hari dalam bulan (linear). Fase 2 dapat memakai pola historis harian/mingguan — keputusan metode forecast (C9).",
        "Progres vs expected = GMV MTD ÷ Expected MTD → menentukan Status. Forecast di sini = run rate linear (baseline yang bisa dijelaskan).",
        "Run rate dibutuhkan = (Target − GMV MTD) ÷ sisa hari. Target DEMO disusun agar Shopee = On Track, TikTok Shop jatuh di rentang 80–90% (perlu konfirmasi ambang), Tokopedia = At Risk.",
    ]
    for n in notes3:
        ws.cell(row=r, column=1, value=n).font = F_NOTE
        r += 1
    r += 1

    # --- Section 4: per listing (MTD)
    ws.cell(row=r, column=1, value="4. Kinerja per listing bulan berjalan (sumber: kinerja_produk_harian + master_listing)").font = F_SUB
    r += 1
    h4 = ["Channel", "ID produk channel", "ID SKU channel", "Nama listing", "Baris master", "SKU internal", "Isi per listing",
          "GMV MTD (Rp)", "Unit listing MTD", "Unit SKU internal MTD"]
    for c, h in enumerate(h4, start=1):
        ws.cell(row=r, column=c, value=h)
    style_header(ws, r, len(h4))
    r += 1
    sec4_first = r
    date_crit = f'({p_date}>=DATE(YEAR({CUT}),MONTH({CUT}),1))*({p_date}<={CUT})'
    for l in LISTINGS:
        ws.cell(row=r, column=1, value=l.channel).font = F_INPUT
        ws.cell(row=r, column=2, value=l.product_id).font = F_INPUT
        ws.cell(row=r, column=3, value=l.sku_id).font = F_INPUT
        ws.cell(row=r, column=4, value=l.name).font = F_INPUT
        ws.cell(row=r, column=5, value=f"=SUMPRODUCT(({m_ch}=$A{r})*({m_pid}=$B{r})*({m_sid}=$C{r})*ROW({m_ch}))")
        ws.cell(row=r, column=6, value=f'=IF(E{r}=0,"{UNMAPPED}",IF(INDEX({M}!$E:$E,E{r})="","{UNMAPPED}",INDEX({M}!$E:$E,E{r})))')
        ws.cell(row=r, column=7, value=f"=IF(E{r}=0,1,INDEX({M}!$F:$F,E{r}))")
        match = f"({p_ch}=$A{r})*({p_pid}=$B{r})*({p_sid}=$C{r})*{date_crit}"
        ws.cell(row=r, column=8, value=f"=SUMPRODUCT({match}*{p_gmv})")
        ws.cell(row=r, column=9, value=f"=SUMPRODUCT({match}*{p_unit})")
        ws.cell(row=r, column=10, value=f"=I{r}*G{r}")
        for c in (8, 9, 10):
            ws.cell(row=r, column=c).number_format = NUM
        for c in (5, 6, 7):
            ws.cell(row=r, column=c).font = F_LINK
        r += 1
    sec4_last = r - 1
    ws.cell(row=r, column=1, value="Total listing").font = F_BOLD
    ws.cell(row=r, column=8, value=f"=SUM(H{sec4_first}:H{sec4_last})").number_format = NUM
    ws.cell(row=r, column=8).font = F_BOLD
    tot4 = r
    r += 1
    ws.cell(row=r, column=1, value="Cek konsistensi: GMV toko MTD − Σ GMV listing MTD (harus 0)").font = F_NOTE
    ws.cell(row=r, column=8, value=f"=C{sec3_rows['SEMUA']}-H{tot4}").number_format = NUM
    check_r = r
    r += 2

    # --- Section 5: per internal SKU (MTD)
    ws.cell(row=r, column=1, value="5. Kinerja per SKU internal bulan berjalan").font = F_SUB
    r += 1
    h5 = ["SKU internal", "GMV MTD (Rp)", "Kontribusi GMV", "Unit SKU internal MTD"]
    for c, h in enumerate(h5, start=1):
        ws.cell(row=r, column=c, value=h)
    style_header(ws, r, len(h5))
    r += 1
    skus = sorted({l.sku_internal for l in LISTINGS if l.sku_internal}) + [UNMAPPED]
    sec5_first = r
    sec5_rows = {}
    for sku in skus:
        ws.cell(row=r, column=1, value=sku).font = F_INPUT
        ws.cell(row=r, column=2, value=f"=SUMIFS($H${sec4_first}:$H${sec4_last},$F${sec4_first}:$F${sec4_last},$A{r})").number_format = NUM
        ws.cell(row=r, column=3, value=f'=IF($H${tot4}=0,"",B{r}/$H${tot4})').number_format = PCT
        ws.cell(row=r, column=4, value=f"=SUMIFS($J${sec4_first}:$J${sec4_last},$F${sec4_first}:$F${sec4_last},$A{r})").number_format = NUM
        sec5_rows[sku] = r
        r += 1
    ws.cell(row=r, column=1, value="Bundle (MU-PKT-KLG-01) ditampilkan sebagai SKU sendiri; pemecahan unit ke komponen = keputusan C11. "
            "Listing 'BELUM DIPETAKAN' tetap dihitung di total channel tetapi tidak masuk analisis SKU.").font = F_NOTE
    r += 2

    # --- Section 6: expected import errors
    ws.cell(row=r, column=1, value="6. File error (csv/ERROR_kinerja_toko_harian_DEMO.csv): hasil validasi yang diharapkan").font = F_SUB
    r += 1
    h6 = ["Baris file", "Kolom", "Kode", "Tingkat", "Pesan yang diharapkan"]
    for c, h in enumerate(h6, start=1):
        ws.cell(row=r, column=c, value=h)
    style_header(ws, r, len(h6))
    r += 1
    for e in error_spec:
        for c, k in enumerate(("line", "column", "code", "severity", "message"), start=1):
            ws.cell(row=r, column=c, value=e[k]).font = F_BASE
        r += 1
    ws.cell(row=r, column=1, value="Baris 2 dan 3 valid. Baris dengan Tingkat 'error' ditolak; 'peringatan' tetap bisa di-commit setelah ditinjau.").font = F_NOTE

    set_widths(ws, [30, 18, 18, 30, 16, 16, 30, 16, 16, 16, 16, 14, 14, 14, 16])
    ws.freeze_panes = "A5"

    # README
    readme_lines = [
        ("Contoh Data DEMO — Fase 2 (E-Commerce Intelligence)", F_TITLE),
        ("SEMUA ANGKA SINTETIS (DEMO). Bukan hasil bisnis Madu Uray. Jangan dipakai untuk keputusan.", F_DEMO),
        ("", F_BASE),
        ("Tujuan", F_SUB),
        ("1. Contoh nyata format standar impor (sheet data = persis isi file yang diunggah).", F_BASE),
        ("2. Pengganti rekonsiliasi: 'Kunci Jawaban' berisi angka yang WAJIB ditampilkan aplikasi untuk data ini (kriteria penerimaan Fase 2).", F_BASE),
        ("3. Data uji otomatis Fase 2 (file dihasilkan deterministik oleh scripts/samples/generate_phase2_samples.py).", F_BASE),
        ("", F_BASE),
        ("Isi", F_SUB),
        (f"• kinerja_toko_harian — {len(shop_rows)} baris, 1 Sep – 10 Nov 2026, 3 channel.", F_BASE),
        (f"• kinerja_produk_harian — {len(product_rows)} baris, 10 listing (cocok dengan master data DEMO Fase 1).", F_BASE),
        (f"• target_bulanan — {len(targets)} baris (Sep–Nov 2026).", F_BASE),
        ("• master_listing — pemetaan listing → SKU internal (2 listing sengaja belum dipetakan).", F_BASE),
        ("• Kunci Jawaban — ringkasan bulanan, MoM periode setara, status target, forecast, run rate, kinerja listing & SKU, hasil validasi file error.", F_BASE),
        ("", F_BASE),
        ("Kasus uji yang sengaja dimasukkan", F_SUB),
        ("• Tokopedia 17 Okt 2026 TIDAK ADA DATA → aplikasi harus menandai Okt Tokopedia 'tidak lengkap', bukan menganggap penjualan nol.", F_BASE),
        ("• Kampanye 9.9 dan 10.10 (lonjakan ±3×), efek gajian (tgl 25–3), pola akhir pekan.", F_BASE),
        ("• 2 listing belum dipetakan: DEMO-TT-2003 (Propolis) & DEMO-TP-3002 (Hutan 1kg).", F_BASE),
        ("• Listing 'Isi 2' (DEMO-SP-1004): unit SKU internal = unit listing × 2.", F_BASE),
        ("• Kolom opsional gmv_retur dikosongkan seluruhnya = data tidak tersedia (bukan nol).", F_BASE),
        ("• Pesanan toko < Σ pesanan produk (satu pesanan bisa berisi beberapa produk).", F_BASE),
        ("• Status target Nov: Shopee On Track, TikTok Shop di rentang 80–90% (ambang perlu konfirmasi), Tokopedia At Risk.", F_BASE),
        ("• File error terpisah dengan 8 jenis kesalahan + hasil validasi yang diharapkan (Kunci Jawaban §6).", F_BASE),
    ]
    for i, (text, font) in enumerate(readme_lines, start=1):
        readme.cell(row=i, column=1, value=text).font = font
    readme.column_dimensions["A"].width = 140

    for sheet in wb.worksheets:
        apply_font(sheet)
    wb.save(path)
    return {
        "sec1": sec1_rows, "sec2": sec2_rows, "sec3": sec3_rows, "sec5": sec5_rows,
        "check_row": check_r,
    }


def write_csv(path: Path, key: str, rows):
    cols = [c[0] for c in TEMPLATES[key]["columns"]]
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for row in rows:
            out = []
            for c in cols:
                v = row.get(c)
                out.append("" if v is None else (v.isoformat() if isinstance(v, date) else v))
            w.writerow(out)


def write_error_csv(path: Path, shop_rows):
    """A small kinerja_toko_harian file with deliberate problems + the expected validation result."""
    cols = [c[0] for c in TEMPLATES["kinerja_toko_harian"]["columns"]]
    valid = [r for r in shop_rows if r["tanggal"] == date(2026, 11, 10)][:2]
    base = lambda r: ["" if r.get(c) is None else (r[c].isoformat() if isinstance(r[c], date) else r[c]) for c in cols]
    rows = [base(valid[0]), base(valid[1])]
    errors = []

    def add(row, line, column, code, severity, message):
        rows.append(row)
        errors.append({"line": line, "column": column, "code": code, "severity": severity, "message": message})

    tpl = base(valid[0])
    r = list(tpl); r[0] = "31/09/2026"
    add(r, 4, "tanggal", "invalid_date", "error", "Tanggal tidak valid (31 September tidak ada); gunakan YYYY-MM-DD.")
    r = list(tpl); r[0] = "2026-11-09"; r[1] = "lazada"
    add(r, 5, "channel", "unknown_channel", "error", "Channel 'lazada' tidak dikenal (shopee | tiktok_shop | tokopedia).")
    r = list(tpl); r[0] = "2026-11-08"; r[2] = "-150000"
    add(r, 6, "gmv", "negative_value", "error", "GMV tidak boleh negatif.")
    r = list(tpl); r[0] = "2026-11-07"; r[2] = "1,2jt"
    add(r, 7, "gmv", "invalid_number", "error", "Angka tidak valid '1,2jt'; tulis 1200000 tanpa singkatan/pemisah ribuan.")
    add(list(tpl), 8, "tanggal+channel", "duplicate_key", "error", "Duplikat baris 2 (tanggal + channel sama) dalam satu file.")
    r = list(tpl); r[0] = "2026-11-06"; r[3] = "50"; r[5] = "20"
    add(r, 9, "pengunjung", "conversion_over_100", "peringatan", "Pesanan (50) > pengunjung (20): Conversion Rate > 100%. Periksa sumber data.")
    r = list(tpl); r[0] = "2026-11-05"; r[2] = ""
    add(r, 10, "gmv", "missing_required", "error", "Kolom wajib 'gmv' kosong.")
    r = list(tpl); r[0] = "2026-12-01"
    add(r, 11, "tanggal", "future_date", "error", "Tanggal di masa depan (setelah tanggal unggah).")

    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerows(rows)
    return errors


def compute_expected(shop_rows, product_rows, targets):
    """Independent Python computation of the answer key (used to verify the formulas)."""
    def shop(ch, start, end, field):
        return sum(r[field] for r in shop_rows if start <= r["tanggal"] <= end and (ch == "SEMUA" or r["channel"] == ch))

    exp = {"sec1": {}, "sec2": {}, "sec3": {}, "sec5": {}}
    for label, start, end in [("Sep 2026", date(2026, 9, 1), date(2026, 9, 30)),
                              ("Okt 2026", date(2026, 10, 1), date(2026, 10, 31)),
                              ("Nov 2026 (MTD)", date(2026, 11, 1), CUTOFF)]:
        for ch in CHANNELS + ["SEMUA"]:
            gmv, orders, vis = shop(ch, start, end, "gmv"), shop(ch, start, end, "pesanan"), shop(ch, start, end, "pengunjung")
            days = len({(r["channel"], r["tanggal"]) for r in shop_rows if start <= r["tanggal"] <= end and (ch == "SEMUA" or r["channel"] == ch)})
            exp["sec1"][(label, ch)] = {"F": days, "H": gmv, "I": orders, "J": gmv / orders, "M": orders / vis}
    cur = (date(2026, 11, 1), CUTOFF)
    prv = (date(2026, 10, 1), date(2026, 10, 10))
    for ch in CHANNELS + ["SEMUA"]:
        g1, g0 = shop(ch, *cur, "gmv"), shop(ch, *prv, "gmv")
        exp["sec2"][ch] = {"B": g1, "C": g0, "D": g1 / g0 - 1}
    dim, el = 30, CUTOFF.day
    tsum = 0
    for ch in CHANNELS + ["SEMUA"]:
        if ch == "SEMUA":
            t = tsum
        else:
            t = next(x["target_gmv"] for x in targets if x["bulan"] == "2026-11" and x["channel"] == ch)
            tsum += t
        mtd = shop(ch, *cur, "gmv")
        prog = mtd / (t * el / dim)
        status = "On Track" if prog >= 0.9 else ("Watch" if prog >= 0.7 else "At Risk")
        exp["sec3"][ch] = {"B": t, "C": mtd, "E": prog, "F": status, "I": max(0, (t - mtd) / (dim - el)), "J": mtd / el * dim}
    sku_gmv: dict[str, float] = {}
    for r in product_rows:
        if not (cur[0] <= r["tanggal"] <= cur[1]):
            continue
        l = next(x for x in LISTINGS if x.channel == r["channel"] and x.product_id == r["id_produk_channel"] and x.sku_id == r["id_sku_channel"])
        key = l.sku_internal or UNMAPPED
        sku_gmv[key] = sku_gmv.get(key, 0) + r["gmv"]
    for k, v in sku_gmv.items():
        exp["sec5"][k] = {"B": v}
    return exp


def main():
    root = Path(__file__).resolve().parents[2]
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "samples" / "phase-2"
    out.mkdir(parents=True, exist_ok=True)

    shop_rows, product_rows = generate()
    targets = build_targets(shop_rows)

    build_template_workbook(out / "Template_Standar_Impor.xlsx")
    write_csv_templates(out / "templates")

    (out / "csv").mkdir(exist_ok=True)
    write_csv(out / "csv" / "kinerja_toko_harian_DEMO.csv", "kinerja_toko_harian", shop_rows)
    write_csv(out / "csv" / "kinerja_produk_harian_DEMO.csv", "kinerja_produk_harian", product_rows)
    write_csv(out / "csv" / "target_bulanan_DEMO.csv", "target_bulanan", targets)
    write_csv(out / "csv" / "master_listing_DEMO.csv", "master_listing", [
        {"channel": l.channel, "id_produk_channel": l.product_id, "id_sku_channel": l.sku_id, "nama_listing": l.name,
         "sku_internal": l.sku_internal, "isi_per_listing": l.units_per_listing} for l in LISTINGS])
    errors = write_error_csv(out / "csv" / "ERROR_kinerja_toko_harian_DEMO.csv", shop_rows)

    layout = build_sample_workbook(out / "Contoh_Data_DEMO_Sep-Nov2026.xlsx", shop_rows, product_rows, targets, errors)
    expected = compute_expected(shop_rows, product_rows, targets)

    # Machine-readable expectations for Phase 2 automated tests + formula verification.
    def ser(d):
        return {("|".join(k) if isinstance(k, tuple) else k): v for k, v in d.items()}
    (out / "expected.json").write_text(json.dumps({
        "layout": {k: ser(v) if isinstance(v, dict) else v for k, v in layout.items()},
        "expected": {k: ser(v) for k, v in expected.items()},
        "errors": errors,
    }, indent=2, ensure_ascii=False))
    print(json.dumps({"shop_rows": len(shop_rows), "product_rows": len(product_rows), "targets": len(targets), "out": str(out)}))


if __name__ == "__main__":
    main()
