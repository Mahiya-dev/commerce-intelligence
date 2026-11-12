-- =============================================================================
-- 0010_creative_meta_ads (Phase 4 — Kreatif Meta)
--
--   creative_assets           library (metadata + link; no file upload yet)
--   meta_ads                  one row per ORIGINAL Meta Ad ID (kept as text)
--   creative_classifications  hook/angle/format/batch/version per ad:
--                             parsed from the ad name, correctable by users
--                             (manual corrections survive re-imports)
--   meta_ad_daily_facts       ← meta_ads_harian   org × ad × date
-- =============================================================================

CREATE TABLE IF NOT EXISTS creative_assets (
  id               CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name             VARCHAR(200) NOT NULL,
  format           ENUM('motion_image', 'video_in_frame', 'video', 'image', 'carousel', 'lainnya') NOT NULL,
  url              VARCHAR(1000) NULL,
  thumbnail_url    VARCHAR(1000) NULL,
  variant_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  notes            VARCHAR(1000) NULL,
  is_demo          TINYINT(1) NOT NULL DEFAULT 0,
  created_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY creative_assets_org_id_key (organization_id, id),
  KEY creative_assets_org_created_idx (organization_id, created_at),
  CONSTRAINT creative_assets_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT creative_assets_variant_fk FOREIGN KEY (organization_id, variant_id)
    REFERENCES product_variants (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT creative_assets_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT creative_assets_url_scheme CHECK (url IS NULL OR url LIKE 'https://%'),
  CONSTRAINT creative_assets_thumb_scheme CHECK (thumbnail_url IS NULL OR thumbnail_url LIKE 'https://%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_ads (
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Original Meta Ad ID, stored as text so long numeric ids never change.
  ad_id            VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ad_name          VARCHAR(255) NOT NULL,
  campaign_name    VARCHAR(255) NULL,
  adset_name       VARCHAR(255) NULL,
  asset_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  is_demo          TINYINT(1) NOT NULL DEFAULT 0,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, ad_id),
  CONSTRAINT meta_ads_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT meta_ads_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES creative_assets (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT meta_ads_ad_id_format CHECK (ad_id REGEXP '^[0-9A-Za-z_-]{1,32}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS creative_classifications (
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ad_id            VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product          VARCHAR(64) NULL,
  hook             VARCHAR(64) NULL,
  angle            VARCHAR(64) NULL,
  format           ENUM('motion_image', 'video_in_frame', 'video', 'image', 'carousel', 'lainnya') NULL,
  batch            VARCHAR(16) NULL,
  version          VARCHAR(16) NULL,
  -- parsed = from the ad name; manual = corrected by a user (never overwritten by imports).
  source           ENUM('parsed', 'manual') NOT NULL DEFAULT 'parsed',
  parse_status     ENUM('ok', 'partial', 'failed') NOT NULL,
  updated_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, ad_id),
  CONSTRAINT creative_classifications_ad_fk FOREIGN KEY (organization_id, ad_id)
    REFERENCES meta_ads (organization_id, ad_id) ON DELETE CASCADE,
  CONSTRAINT creative_classifications_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Money in whole rupiah. reach NULL = not reported (frequency then unknown).
CREATE TABLE IF NOT EXISTS meta_ad_daily_facts (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ad_id             VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fact_date         DATE NOT NULL,
  spend             BIGINT NOT NULL,
  impressions       INT NOT NULL,
  reach             INT NULL,
  link_clicks       INT NOT NULL,
  purchases         INT NOT NULL,
  purchase_value    BIGINT NOT NULL,
  source_batch_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_demo           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, ad_id, fact_date),
  KEY meta_ad_daily_facts_org_date_idx (organization_id, fact_date),
  KEY meta_ad_daily_facts_batch_idx (organization_id, source_batch_id),
  CONSTRAINT meta_ad_daily_facts_ad_fk FOREIGN KEY (organization_id, ad_id)
    REFERENCES meta_ads (organization_id, ad_id) ON DELETE RESTRICT,
  CONSTRAINT meta_ad_daily_facts_batch_fk FOREIGN KEY (organization_id, source_batch_id)
    REFERENCES import_batches (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT meta_ad_daily_facts_nonneg CHECK (
    spend >= 0 AND impressions >= 0 AND link_clicks >= 0 AND purchases >= 0 AND purchase_value >= 0
    AND (reach IS NULL OR reach >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
