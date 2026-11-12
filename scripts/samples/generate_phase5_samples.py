#!/usr/bin/env python3
"""
Phase 5 (Afiliasi HSL) DEMO samples — deterministic, SYNTHETIC data.

Writes samples/phase-5/:
  csv/penjualan_hsl_DEMO.csv     HSL sales per affiliate × Shopee listing × day, 1 Aug – 10 Nov 2026
  csv/stok_masuk_DEMO.csv        warehouse receipts (sku, tanggal, jumlah, catatan)
  csv/alokasi_hsl_DEMO.csv       historical allocations (tanggal, username, sku, jumlah) — replayed through
                                 the real propose → approve → apply workflow by the seed
  templates/penjualan_hsl.csv    header-only template

Stock rule kept by construction: each allocation covers the next period's sales × ~1.15, so an
affiliate never sells more than it was allocated. The last allocation (25 Oct) is deliberately thin
so the app has fresh recommendations on 10 Nov.

Stories: @madu.mama grows fast; @sehat.bersama and @dapur.sehat steady; @healthy.dina declining;
@kopi.pagi stopped selling in September but still holds stock (idle stock → return candidate).

Run:  python3 scripts/samples/generate_phase5_samples.py
"""
import csv
import math
import random
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "samples" / "phase-5"
START, END = date(2026, 8, 1), date(2026, 11, 10)

LISTINGS = [  # (id_produk, id_sku, name, sku_internal, units per listing, price)
    ("DEMO-SP-1001", "DEMO-SP-1001-A", "Madu Hutan Asli Uray 250gr", "MU-HUTAN-250", 1, 92_000),
    ("DEMO-SP-1001", "DEMO-SP-1001-B", "Madu Hutan Asli Uray 500gr", "MU-HUTAN-500", 1, 158_000),
    ("DEMO-SP-1002", "", "Madu Kelengkeng Uray 500gr", "MU-KLG-500", 1, 149_000),
    ("DEMO-SP-1003", "", "Paket Keluarga Sehat Madu Uray", "MU-PKT-KLG-01", 1, 315_000),
    ("DEMO-SP-1004", "", "Madu Hutan 500gr Isi 2 (Hemat)", "MU-HUTAN-500", 2, 298_000),
]
# username, name, commission, base units/day per listing index, trend per day, stop date
AFFILIATES = [
    ("madu.mama", "Mama Madu", 0.10, {1: 2.2, 4: 0.8, 0: 1.0}, 0.012, None),
    ("sehat.bersama", "Sehat Bersama", 0.09, {1: 1.8, 2: 1.0, 3: 0.4}, 0.0, None),
    ("dapur.sehat", "Dapur Sehat Bunda", 0.08, {0: 1.4, 1: 1.0}, 0.002, None),
    ("healthy.dina", "Healthy Dina", 0.10, {1: 1.6, 2: 0.6}, -0.009, None),
    ("ayah.fit", "Ayah Fit", 0.08, {1: 0.9, 3: 0.3}, 0.004, None),
    ("resep.nenek", "Resep Nenek", 0.07, {0: 0.8, 2: 0.5}, 0.0, None),
    ("kopi.pagi", "Kopi Pagi ID", 0.09, {1: 0.9, 0: 0.5}, 0.0, date(2026, 9, 10)),
    ("ibu.cerdas", "Ibu Cerdas", 0.10, {3: 0.5, 4: 0.4}, 0.006, None),
]
ALLOCATION_DATES = [date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1), date(2026, 10, 25)]
COLS = ["tanggal", "username_afiliasi", "nama_afiliasi", "id_produk_channel", "id_sku_channel", "nama_listing",
        "unit_terjual", "gmv", "komisi"]


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def main():
    rng = random.Random(20261114)
    rows = []
    sold = defaultdict(int)  # (username, sku, date) → SKU units
    for username, name, commission, base, trend, stop in AFFILIATES:
        for d in days(START, END):
            if stop and d >= stop:
                break
            age = (d - START).days
            for idx, rate in base.items():
                pid, sid, lname, sku, upl, price = LISTINGS[idx]
                lam = max(0.0, rate * (1 + trend * age) * (1.12 if d.weekday() >= 5 else 1.0))
                # Poisson draw
                k, p, limit = 0, 1.0, math.exp(-lam)
                while True:
                    p *= rng.random()
                    if p <= limit:
                        break
                    k += 1
                if k == 0:
                    continue
                gmv = int(round(k * price * rng.uniform(0.96, 1.02), -2))
                rows.append({
                    "tanggal": d.isoformat(), "username_afiliasi": username, "nama_afiliasi": name,
                    "id_produk_channel": pid, "id_sku_channel": sid, "nama_listing": lname, "unit_terjual": k,
                    "gmv": gmv, "komisi": int(round(gmv * commission, -2)),
                })
                sold[(username, sku, d)] += k * upl
    rows.sort(key=lambda r: (r["tanggal"], r["username_afiliasi"], r["id_produk_channel"], r["id_sku_channel"]))

    # Allocations: cover the next period's sales (+15%), the idle affiliate gets a bigger first lot.
    allocations = []
    bounds = ALLOCATION_DATES + [END + timedelta(days=1)]
    skus = sorted({l[3] for l in LISTINGS})
    for i, start in enumerate(ALLOCATION_DATES):
        end = bounds[i + 1] - timedelta(days=1)
        last = i == len(ALLOCATION_DATES) - 1
        for username, *_ in AFFILIATES:
            for sku in skus:
                need = sum(v for (u, s, d), v in sold.items() if u == username and s == sku and start <= d <= end)
                if need == 0:
                    continue
                qty = math.ceil(need * (1.0 if last else 1.15))
                if username == "kopi.pagi" and i == 0:
                    qty += 40  # stock that will sit idle
                allocations.append({"tanggal": start.isoformat(), "username": username, "sku": sku, "jumlah": qty})
    # Last lot is thin (sales up to 10 Nov exactly), so recommendations appear on 10 Nov.

    total_alloc = defaultdict(int)
    for a in allocations:
        total_alloc[a["sku"]] += a["jumlah"]
    receipts = []
    for sku in skus:
        first_lot = math.ceil(total_alloc[sku] * 0.65 / 10) * 10
        second_lot = math.ceil((total_alloc[sku] - first_lot) / 10) * 10 + 150  # buffer left in the warehouse
        receipts.append({"sku": sku, "tanggal": "2026-07-28", "jumlah": first_lot, "catatan": "Produksi Juli (DEMO)"})
        receipts.append({"sku": sku, "tanggal": "2026-09-28", "jumlah": second_lot, "catatan": "Produksi September (DEMO)"})

    def write(path, cols, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(data)

    write(OUT / "csv" / "penjualan_hsl_DEMO.csv", COLS, rows)
    write(OUT / "csv" / "stok_masuk_DEMO.csv", ["sku", "tanggal", "jumlah", "catatan"], receipts)
    write(OUT / "csv" / "alokasi_hsl_DEMO.csv", ["tanggal", "username", "sku", "jumlah"], allocations)
    write(OUT / "templates" / "penjualan_hsl.csv", COLS, [])
    print(f"sales rows {len(rows)} · allocations {len(allocations)} · receipts {len(receipts)} → {OUT}")


if __name__ == "__main__":
    main()
