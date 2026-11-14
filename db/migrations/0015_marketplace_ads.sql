-- =============================================================================
-- 0015_marketplace_ads
--
--   marketplace_ad_daily_facts ← iklan_marketplace_harian
--     org × channel × date × campaign (marketplace ads, e.g. Shopee Ads CPC /
--     GMV Max). Shop-level campaigns have no product code.
--
-- campaign_key = SHA-256 of "jenis_iklan|nama_iklan|kode_produk" (lower-case),
-- computed by the app: Shopee exports no campaign ID.
-- Re-runnable: ENUM redefinitions are idempotent; CREATE TABLE IF NOT EXISTS.
-- =============================================================================

ALTER TABLE data_mapping_profiles
  MODIFY COLUMN report_type ENUM(
    'marketplace_sales_daily', 'marketplace_product_performance', 'marketplace_traffic',
    'meta_ads_performance', 'shopee_hsl_affiliate', 'product_master',
    'channel_listing_master', 'inventory_snapshot', 'event_costs', 'sales_target',
    'touchpoint_performance', 'marketplace_ads_daily') NOT NULL;

ALTER TABLE import_batches
  MODIFY COLUMN report_type ENUM(
    'marketplace_sales_daily', 'marketplace_product_performance', 'marketplace_traffic',
    'meta_ads_performance', 'shopee_hsl_affiliate', 'product_master',
    'channel_listing_master', 'inventory_snapshot', 'event_costs', 'sales_target',
    'touchpoint_performance', 'marketplace_ads_daily') NOT NULL;

CREATE TABLE IF NOT EXISTS marketplace_ad_daily_facts (
  organization_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fact_date           DATE NOT NULL,
  campaign_key        CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  campaign_name       VARCHAR(255) NOT NULL,
  ad_type             VARCHAR(64) NOT NULL,
  bidding_mode        VARCHAR(64) NULL,
  product_code        VARCHAR(128) NULL,
  impressions         BIGINT NOT NULL,
  clicks              INT NOT NULL,
  conversions         INT NOT NULL,
  direct_conversions  INT NULL,
  units_sold          INT NOT NULL,
  direct_units_sold   INT NULL,
  -- Sales attributed to the ads by the marketplace (Shopee: "Omzet Penjualan").
  gmv                 BIGINT NOT NULL,
  direct_gmv          BIGINT NULL,
  cost                BIGINT NOT NULL,
  source_batch_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_demo             TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, channel_id, fact_date, campaign_key),
  KEY marketplace_ad_daily_facts_org_date_idx (organization_id, fact_date),
  KEY marketplace_ad_daily_facts_batch_idx (organization_id, source_batch_id),
  KEY marketplace_ad_daily_facts_channel_idx (channel_id),
  CONSTRAINT marketplace_ad_daily_facts_org_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT marketplace_ad_daily_facts_channel_fk FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE RESTRICT,
  CONSTRAINT marketplace_ad_daily_facts_batch_fk FOREIGN KEY (organization_id, source_batch_id)
    REFERENCES import_batches (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT marketplace_ad_daily_facts_key_hex CHECK (campaign_key REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT marketplace_ad_daily_facts_nonneg CHECK (
    impressions >= 0 AND clicks >= 0 AND conversions >= 0 AND units_sold >= 0 AND gmv >= 0 AND cost >= 0
    AND (direct_conversions IS NULL OR direct_conversions >= 0)
    AND (direct_units_sold IS NULL OR direct_units_sold >= 0)
    AND (direct_gmv IS NULL OR direct_gmv >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
