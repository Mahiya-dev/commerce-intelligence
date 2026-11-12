#!/usr/bin/env python3
"""
Phase 4 (Kreatif Meta) DEMO samples — deterministic, SYNTHETIC data.

Writes samples/phase-4/:
  csv/meta_ads_harian_DEMO.csv      daily Meta ad performance, 1 Jun – 10 Nov 2026
  csv/creative_assets_DEMO.csv      asset library (metadata + example links) and the ads using each asset
  templates/meta_ads_harian.csv     header-only template

Stories:
  - Video in Frame (VIF) gets a higher CTR; Motion Image (MI) a lower CPM.
  - A new batch (B01…B06) launches about every 4 weeks; V2 is a variant of V1.
  - Some creatives fatigue fast (CTR decays, frequency climbs) and are switched off;
    TESTIMONI hooks last longer than PROMO hooks.
  - Two ads do not follow the naming convention (partial / failed parse).
Ad naming convention: PRODUK_HOOK_ANGLE_FORMAT_BATCH_VERSI.

Run:  python3 scripts/samples/generate_phase4_samples.py
"""
import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "samples" / "phase-4"
START, END = date(2026, 6, 1), date(2026, 11, 10)

COLS = ["tanggal", "ad_id", "nama_iklan", "nama_kampanye", "nama_adset", "spend", "impresi", "jangkauan", "klik",
        "pembelian", "nilai_pembelian"]
ASSET_COLS = ["nama", "format", "url", "sku", "catatan", "ad_ids"]

PRODUCTS = {  # product code → (internal SKU, average order value)
    "HUTAN500": ("MU-HUTAN-500", 152_000),
    "HUTAN250": ("MU-HUTAN-250", 88_000),
    "KLC150": ("MU-KLC-150", 118_000),
    "KLG500": ("MU-KLG-500", 142_000),
    "PKTKLG": ("MU-PKT-KLG-01", 318_000),
    "RANDU500": ("MU-RANDU-500", 98_000),
}
FORMAT_NAMES = {"MI": "motion_image", "VIF": "video_in_frame", "VID": "video", "IMG": "image"}
# Creative concept per batch: (product, hook, angle, format)
BATCHES = [
    ("B01", date(2026, 6, 1), [("HUTAN500", "TESTIMONI", "KESEHATAN", "VIF"), ("HUTAN500", "PROMO", "HEMAT", "MI"),
                               ("RANDU500", "EDUKASI", "ASLI", "MI"), ("HUTAN250", "MASALAH", "KESEHATAN", "VIF")]),
    ("B02", date(2026, 6, 29), [("KLC150", "UNBOXING", "ASLI", "VIF"), ("HUTAN500", "MASALAH", "KELUARGA", "MI"),
                                ("KLG500", "TESTIMONI", "KELUARGA", "VIF"), ("PKTKLG", "PROMO", "HADIAH", "IMG")]),
    ("B03", date(2026, 7, 27), [("HUTAN500", "TESTIMONI", "ASLI", "VIF"), ("KLC150", "EDUKASI", "KESEHATAN", "MI"),
                                ("RANDU500", "PROMO", "HEMAT", "MI"), ("HUTAN250", "UNBOXING", "HEMAT", "VID")]),
    ("B04", date(2026, 8, 24), [("KLC150", "TESTIMONI", "KESEHATAN", "VIF"), ("HUTAN500", "PROMO", "HEMAT", "VIF"),
                                ("KLG500", "MASALAH", "KESEHATAN", "MI")]),
    ("B05", date(2026, 9, 21), [("HUTAN500", "EDUKASI", "ASLI", "VIF"), ("PKTKLG", "TESTIMONI", "HADIAH", "VIF"),
                                ("KLC150", "PROMO", "HEMAT", "MI")]),
    ("B06", date(2026, 10, 19), [("HUTAN500", "MASALAH", "KESEHATAN", "VIF"), ("KLC150", "UNBOXING", "KELUARGA", "MI")]),
]
HOOK_DECAY = {"TESTIMONI": 70, "EDUKASI": 55, "MASALAH": 45, "UNBOXING": 40, "PROMO": 24}  # days
PRODUCT_CVR = {"HUTAN500": 0.042, "HUTAN250": 0.03, "KLC150": 0.05, "KLG500": 0.034, "PKTKLG": 0.022,
               "RANDU500": 0.018}


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def main():
    rng = random.Random(20261113)
    ads = []
    seq = 0
    for batch, launch, concepts in BATCHES:
        for product, hook, angle, fmt in concepts:
            for version, delay in (("V1", 0), ("V2", rng.randint(5, 12))):
                if version == "V2" and rng.random() < 0.35:
                    continue  # not every concept gets a second version
                seq += 1
                ads.append({
                    "ad_id": str(120_214_500_000_000_000 + seq * 7_919),
                    "name": f"{product}_{hook}_{angle}_{fmt}_{batch}_{version}",
                    "product": product, "hook": hook, "angle": angle, "fmt": fmt, "batch": batch,
                    "launch": launch + timedelta(days=delay),
                    "campaign": f"MU_{'KONVERSI' if hook != 'EDUKASI' else 'TRAFFIC'}_{batch}",
                    "adset": f"{PRODUCTS[product][0]}_LOOKALIKE_{'25-44' if rng.random() < 0.6 else '35-54'}",
                    "decay": HOOK_DECAY[hook] * rng.uniform(0.8, 1.25),
                    "base_ctr": (0.019 if fmt == "VIF" else 0.016 if fmt == "VID" else 0.012) * rng.uniform(0.85, 1.2),
                    "cpm": (42_000 if fmt in ("VIF", "VID") else 31_000) * rng.uniform(0.9, 1.15),
                    "budget": rng.choice([250_000, 350_000, 500_000, 750_000]),
                    "cvr": PRODUCT_CVR[product] * rng.uniform(0.85, 1.2),
                })
    # Two ads that do not follow the naming convention.
    for i, (name, product, fmt) in enumerate([
        ("Iklan Promo Gajian Oktober Madu Hutan", "HUTAN500", "MI"),
        ("HUTAN500_TESTIMONI_VIF_B05", "HUTAN500", "VIF"),
    ]):
        seq += 1
        ads.append({
            "ad_id": str(120_214_500_000_000_000 + seq * 7_919), "name": name, "product": product, "hook": "PROMO",
            "angle": "HEMAT", "fmt": fmt, "batch": "B05", "launch": date(2026, 10, 1) + timedelta(days=i * 6),
            "campaign": "MU_KONVERSI_GAJIAN", "adset": "MU-HUTAN-500_BROAD", "decay": 30, "base_ctr": 0.014,
            "cpm": 36_000, "budget": 400_000, "cvr": 0.035,
        })

    rows = []
    for ad in ads:
        aov = PRODUCTS[ad["product"]][1]
        for d in days(ad["launch"], END):
            age = (d - ad["launch"]).days
            ctr = ad["base_ctr"] * math.exp(-age / ad["decay"])
            # Media buyers switch off ads whose CTR fell to 40% of launch level.
            if ctr < ad["base_ctr"] * 0.4 and age > 14:
                break
            ramp = min(1.0, 0.45 + age / 10)
            spend = int(round(ad["budget"] * ramp * rng.uniform(0.85, 1.12), -3))
            impressions = int(spend / ad["cpm"] * 1000 * rng.uniform(0.92, 1.08))
            frequency = min(5.5, 1.1 + age * 0.045) * rng.uniform(0.95, 1.05)
            reach = max(1, int(impressions / frequency))
            clicks = max(0, int(round(impressions * ctr * rng.uniform(0.85, 1.15))))
            purchases = sum(1 for _ in range(clicks) if rng.random() < ad["cvr"])
            value = int(round(purchases * aov * rng.uniform(0.9, 1.12), -2))
            rows.append({
                "tanggal": d.isoformat(), "ad_id": ad["ad_id"], "nama_iklan": ad["name"],
                "nama_kampanye": ad["campaign"], "nama_adset": ad["adset"], "spend": spend, "impresi": impressions,
                "jangkauan": reach, "klik": clicks, "pembelian": purchases, "nilai_pembelian": value,
            })
    rows.sort(key=lambda r: (r["tanggal"], r["ad_id"]))

    # One asset per creative concept (V1 and V2 share it).
    assets = {}
    for ad in ads:
        key = (ad["product"], ad["hook"], ad["angle"], ad["fmt"], ad["batch"])
        a = assets.setdefault(key, {
            "nama": f"{ad['product']} · {ad['hook'].title()} · {ad['angle'].title()} ({ad['batch']})",
            "format": FORMAT_NAMES[ad["fmt"]],
            "url": f"https://example.com/demo/kreatif/{ad['batch'].lower()}-{ad['product'].lower()}-{ad['hook'].lower()}",
            "sku": PRODUCTS[ad["product"]][0],
            "catatan": "DEMO — contoh metadata aset; tautan bukan file asli.",
            "ad_ids": [],
        })
        a["ad_ids"].append(ad["ad_id"])
    asset_rows = [{**a, "ad_ids": ";".join(a["ad_ids"])} for a in assets.values()]

    def write(path, cols, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(data)

    write(OUT / "csv" / "meta_ads_harian_DEMO.csv", COLS, rows)
    write(OUT / "csv" / "creative_assets_DEMO.csv", ASSET_COLS, asset_rows)
    write(OUT / "templates" / "meta_ads_harian.csv", COLS, [])
    print(f"ads {len(ads)} · rows {len(rows)} · assets {len(asset_rows)} → {OUT}")


if __name__ == "__main__":
    main()
