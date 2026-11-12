#!/usr/bin/env python3
"""
Phase 3 (Portofolio Produk) DEMO samples — deterministic, SYNTHETIC data.

Writes samples/phase-3/:
  csv/kinerja_toko_harian_HISTORI_DEMO.csv     1 Dec 2025 – 31 Aug 2026 (before the Phase 2 data)
  csv/kinerja_produk_harian_HISTORI_DEMO.csv   same period, same 10 listings as Phase 2
  csv/kinerja_touchpoint_DEMO.csv              1 Dec 2025 – 10 Nov 2026, splits every product row
  templates/kinerja_touchpoint.csv             header-only template

The Phase 2 files (Sep–Nov 2026) and their answer key are NOT changed: the
history is anchored on September 2026 levels so the series joins smoothly.
Consistency rules (same as Phase 2):
  shop GMV / units = sum of listing GMV / units per channel per day
  shop orders      ≈ 93% of the sum of listing orders (one order can hold several products)
  touchpoint GMV / orders / units per listing per day = exactly the product row

Each SKU follows a "story" so the portfolio matrix moves over time:
  MU-HUTAN-500   large and steady (Bintang / Penopang)
  MU-HUTAN-250   shrinking (Penopang → Evaluasi)
  MU-KLC-150     fast-growing via TikTok Live (Potensial; share stays small)
  MU-KLG-500     flat
  MU-PKT-KLG-01  bundle, Ramadan/Lebaran spike (Feb–Mar 2026)
  MU-RANDU-500   declining, ads with weak ROAS (Evaluasi)
  Propolis / Madu Hutan 1kg: unmapped listings (kept out of the SKU matrix)

Run:  python3 scripts/samples/generate_phase3_samples.py
"""
import csv
import random
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
P2 = ROOT / "samples" / "phase-2" / "csv"
OUT = ROOT / "samples" / "phase-3"

HIST_START, HIST_END = date(2025, 12, 1), date(2026, 8, 31)
TP_END = date(2026, 11, 10)
ANCHOR = "2026-09"  # monthly factor 1.0 = September 2026 level

SHOP_COLS = ["tanggal", "channel", "gmv", "pesanan", "unit_terjual", "pengunjung", "pembeli",
             "pesanan_batal", "gmv_batal", "gmv_retur"]
PROD_COLS = ["tanggal", "channel", "id_produk_channel", "id_sku_channel", "nama_listing", "gmv", "pesanan",
             "unit_terjual", "pengunjung_produk", "klik_produk", "pesanan_batal"]
TP_COLS = ["tanggal", "channel", "id_produk_channel", "id_sku_channel", "nama_listing", "touchpoint", "gmv",
           "pesanan", "unit_terjual", "biaya"]
TOUCHPOINTS = ["organik", "iklan", "afiliasi", "live", "video"]

MONTHS = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", ANCHOR]

# Monthly GMV factor vs September 2026, per listing (Dec 2025 … Aug 2026, Sep = 1.0).
STORY = {
    "DEMO-SP-1001|DEMO-SP-1001-A": [2.30, 2.20, 2.05, 1.90, 1.65, 1.45, 1.30, 1.15, 1.04],  # HUTAN-250 shrinking
    "DEMO-SP-1001|DEMO-SP-1001-B": [0.82, 0.84, 0.90, 0.95, 0.90, 0.92, 0.94, 0.96, 0.98],  # HUTAN-500 steady
    "DEMO-SP-1002|": [1.00, 0.98, 1.02, 1.05, 0.99, 1.00, 0.97, 1.01, 0.99],  # KLG-500 flat
    "DEMO-SP-1003|": [0.95, 0.90, 1.70, 1.90, 0.85, 0.80, 0.82, 0.86, 0.92],  # bundle, Ramadan spike
    "DEMO-SP-1004|": [0.70, 0.72, 0.80, 0.85, 0.82, 0.86, 0.90, 0.93, 0.97],  # HUTAN-500 isi 2
    "DEMO-TT-2001|DEMO-TT-2001-1": [0.60, 0.65, 0.75, 0.82, 0.80, 0.85, 0.88, 0.92, 0.96],  # HUTAN-500 TikTok
    "DEMO-TT-2002|": [0.22, 0.26, 0.32, 0.38, 0.45, 0.55, 0.65, 0.76, 0.88],  # KLC-150 fast growth
    "DEMO-TT-2003|": [0.40, 0.45, 0.55, 0.62, 0.68, 0.74, 0.80, 0.88, 0.94],  # Propolis (unmapped)
    "DEMO-TP-3001|": [1.80, 1.72, 1.65, 1.60, 1.50, 1.40, 1.30, 1.20, 1.10],  # RANDU-500 declining
    "DEMO-TP-3002|": [1.00, 1.02, 1.05, 1.08, 1.00, 0.98, 1.00, 1.01, 0.99],  # Hutan 1kg (unmapped)
}

# Touchpoint GMV mix per listing: (share at Dec 2025, share at Nov 2026), linear in between.
MIX = {
    "shopee": {"organik": (0.52, 0.46), "iklan": (0.30, 0.30), "afiliasi": (0.13, 0.16), "live": (0.05, 0.08),
               "video": (0.00, 0.00)},
    "tiktok_shop": {"organik": (0.30, 0.20), "iklan": (0.25, 0.20), "afiliasi": (0.25, 0.25), "live": (0.12, 0.25),
                    "video": (0.08, 0.10)},
    "tokopedia": {"organik": (0.62, 0.60), "iklan": (0.38, 0.40), "afiliasi": (0.0, 0.0), "live": (0.0, 0.0),
                  "video": (0.0, 0.0)},
}
# Klanceng grows through TikTok Live: much higher live share.
MIX_OVERRIDE = {
    "DEMO-TT-2002|": {"organik": (0.30, 0.12), "iklan": (0.25, 0.13), "afiliasi": (0.20, 0.20), "live": (0.15, 0.45),
                      "video": (0.10, 0.10)},
}
# Ads ROAS (GMV ÷ ad spend) per listing; Randu's ads barely pay back.
ROAS = defaultdict(lambda: 6.0, {
    "DEMO-SP-1001|DEMO-SP-1001-B": 7.5, "DEMO-TT-2001|DEMO-TT-2001-1": 6.5, "DEMO-TT-2002|": 9.0,
    "DEMO-SP-1003|": 4.0, "DEMO-TP-3001|": 1.6, "DEMO-SP-1001|DEMO-SP-1001-A": 3.2,
})
AFFILIATE_COMMISSION = 0.10
LIVE_COST_SHARE = 0.12  # host + production cost as a share of live GMV


def read(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write(path, cols, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


def days(start, end):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def month_factor(series, d):
    """Daily factor: linear interpolation between mid-month points (smooth trend)."""
    points = []
    for i, ym in enumerate(MONTHS):
        y, m = map(int, ym.split("-"))
        points.append((date(y, m, 15), series[i] if i < len(series) else 1.0))
    if d <= points[0][0]:
        return points[0][1]
    for (d0, v0), (d1, v1) in zip(points, points[1:]):
        if d0 <= d <= d1:
            t = (d - d0).days / (d1 - d0).days
            return v0 + (v1 - v0) * t
    return points[-1][1]


def seasonal(d):
    f = 1.0
    if date(2026, 2, 18) <= d <= date(2026, 3, 19):  # Ramadan 2026 (approx.)
        f *= 1.18
    if d.weekday() >= 5:
        f *= 1.08
    if d.day >= 25 or d.day <= 3:  # payday
        f *= 1.07
    return f


def split_int(total, weights):
    """Largest-remainder split of an integer by weights (sums exactly to total)."""
    s = sum(weights)
    if total == 0 or s == 0:
        return [0] * len(weights)
    raw = [total * w / s for w in weights]
    out = [int(x) for x in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - out[i], reverse=True)[: total - sum(out)]:
        out[i] += 1
    return out


def main():
    rng = random.Random(20261112)
    listings = read(P2 / "master_listing_DEMO.csv")
    p2_prod = read(P2 / "kinerja_produk_harian_DEMO.csv")
    p2_shop = read(P2 / "kinerja_toko_harian_DEMO.csv")
    key = lambda r: f"{r['id_produk_channel']}|{r['id_sku_channel']}"

    # September 2026 baseline per listing (daily averages and ratios).
    base = {}
    for l in listings:
        rows = [r for r in p2_prod if key(r) == key(l) and r["tanggal"].startswith(ANCHOR)]
        n = len(rows)
        tot = lambda c: sum(int(r[c] or 0) for r in rows)
        base[key(l)] = {
            "gmv": tot("gmv") / n,
            "price": tot("gmv") / tot("unit_terjual"),
            "units_per_order": tot("unit_terjual") / tot("pesanan"),
            "visitors_per_order": tot("pengunjung_produk") / tot("pesanan"),
            "clicks_per_visitor": tot("klik_produk") / tot("pengunjung_produk"),
        }

    # Shop-level ratios from September (shop visitors vs product visitors, orders share).
    sep_shop = [r for r in p2_shop if r["tanggal"].startswith(ANCHOR)]
    prod_vis = defaultdict(int)
    for r in p2_prod:
        if r["tanggal"].startswith(ANCHOR):
            prod_vis[r["channel"]] += int(r["pengunjung_produk"] or 0)
    shop_vis_ratio = {
        ch: sum(int(r["pengunjung"]) for r in sep_shop if r["channel"] == ch) / prod_vis[ch]
        for ch in prod_vis
    }

    # --- history: product rows ---------------------------------------------------
    hist_prod = []
    for d in days(HIST_START, HIST_END):
        for l in listings:
            b = base[key(l)]
            gmv_target = b["gmv"] * month_factor(STORY[key(l)], d) * seasonal(d) * rng.uniform(0.85, 1.15)
            units = max(1, round(gmv_target / b["price"]))
            orders = max(1, round(units / b["units_per_order"]))
            units = max(units, orders)
            gmv = int(round(units * b["price"] * rng.uniform(0.97, 1.03), -2))
            visitors = max(orders, round(orders * b["visitors_per_order"] * rng.uniform(0.9, 1.1)))
            clicks = max(visitors, round(visitors * b["clicks_per_visitor"] * rng.uniform(0.92, 1.08)))
            cancelled = sum(1 for _ in range(orders) if rng.random() < 0.035)
            hist_prod.append({
                "tanggal": d.isoformat(), "channel": l["channel"], "id_produk_channel": l["id_produk_channel"],
                "id_sku_channel": l["id_sku_channel"], "nama_listing": l["nama_listing"], "gmv": gmv,
                "pesanan": orders, "unit_terjual": units, "pengunjung_produk": visitors, "klik_produk": clicks,
                "pesanan_batal": cancelled,
            })

    # --- history: shop rows (derived from product rows) ------------------------------
    by_day = defaultdict(lambda: {"gmv": 0, "orders": 0, "units": 0, "visitors": 0})
    for r in hist_prod:
        a = by_day[(r["tanggal"], r["channel"])]
        a["gmv"] += r["gmv"]
        a["orders"] += r["pesanan"]
        a["units"] += r["unit_terjual"]
        a["visitors"] += r["pengunjung_produk"]
    hist_shop = []
    for (day, ch), a in sorted(by_day.items()):
        orders = max(1, round(a["orders"] * rng.uniform(0.91, 0.95)))
        cancelled = sum(1 for _ in range(orders) if rng.random() < 0.04)
        hist_shop.append({
            "tanggal": day, "channel": ch, "gmv": a["gmv"], "pesanan": orders, "unit_terjual": a["units"],
            "pengunjung": round(a["visitors"] * shop_vis_ratio[ch] * rng.uniform(0.95, 1.05)),
            "pembeli": max(1, orders - rng.randint(0, 3)), "pesanan_batal": cancelled,
            "gmv_batal": int(round(cancelled * a["gmv"] / max(orders, 1) * rng.uniform(0.8, 1.2), -2)),
            "gmv_retur": "",
        })

    # --- touchpoints: split every product row (history + Phase 2) --------------------
    span = (TP_END - HIST_START).days
    tp_rows = []
    all_prod = hist_prod + [
        {**r, "gmv": int(r["gmv"]), "pesanan": int(r["pesanan"]), "unit_terjual": int(r["unit_terjual"])}
        for r in p2_prod
    ]
    for r in sorted(all_prod, key=lambda r: (r["tanggal"], r["channel"], r["id_produk_channel"], r["id_sku_channel"])):
        d = date.fromisoformat(r["tanggal"])
        t = (d - HIST_START).days / span
        mix = MIX_OVERRIDE.get(key(r), MIX[r["channel"]])
        weights = [max(0.0, (a + (b - a) * t) * rng.uniform(0.85, 1.15)) for a, b in (mix[tp] for tp in TOUCHPOINTS)]
        gmv = [g * 100 for g in split_int(r["gmv"] // 100, weights)]  # whole hundreds of rupiah
        gmv[gmv.index(max(gmv))] += r["gmv"] % 100  # keep the exact product total
        orders = split_int(r["pesanan"], weights)
        units = split_int(r["unit_terjual"], weights)
        for i, tp in enumerate(TOUCHPOINTS):
            if gmv[i] == 0 and orders[i] == 0 and units[i] == 0:
                continue
            g = gmv[i]
            if tp == "iklan":
                cost = int(round(g / (ROAS[key(r)] * rng.uniform(0.85, 1.15)), -2))
            elif tp == "afiliasi":
                cost = int(round(g * AFFILIATE_COMMISSION, -2))
            elif tp == "live":
                cost = int(round(g * LIVE_COST_SHARE * rng.uniform(0.9, 1.1), -2))
            else:
                cost = ""  # organik / video: no direct cost reported
            tp_rows.append({
                "tanggal": r["tanggal"], "channel": r["channel"], "id_produk_channel": r["id_produk_channel"],
                "id_sku_channel": r["id_sku_channel"], "nama_listing": r["nama_listing"], "touchpoint": tp,
                "gmv": g, "pesanan": orders[i], "unit_terjual": units[i], "biaya": cost,
            })

    write(OUT / "csv" / "kinerja_toko_harian_HISTORI_DEMO.csv", SHOP_COLS, hist_shop)
    write(OUT / "csv" / "kinerja_produk_harian_HISTORI_DEMO.csv", PROD_COLS, hist_prod)
    write(OUT / "csv" / "kinerja_touchpoint_DEMO.csv", TP_COLS, tp_rows)
    write(OUT / "templates" / "kinerja_touchpoint.csv", TP_COLS, [])
    print(f"shop {len(hist_shop)} · product {len(hist_prod)} · touchpoint {len(tp_rows)} rows → {OUT}")


if __name__ == "__main__":
    main()
