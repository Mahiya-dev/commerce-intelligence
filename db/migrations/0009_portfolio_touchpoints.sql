-- =============================================================================
-- 0009_portfolio_touchpoints (Phase 3 — Portofolio Produk)
--
--   touchpoint_daily_facts ← kinerja_touchpoint   org × listing × date × touchpoint
--
-- Plus the Owner-configurable portfolio matrix thresholds on
-- organization_kpi_settings. Re-runnable: ENUM redefinitions are idempotent,
-- columns are added only when missing.
-- =============================================================================

ALTER TABLE data_mapping_profiles
  MODIFY COLUMN report_type ENUM(
    'marketplace_sales_daily', 'marketplace_product_performance', 'marketplace_traffic',
    'meta_ads_performance', 'shopee_hsl_affiliate', 'product_master',
    'channel_listing_master', 'inventory_snapshot', 'event_costs', 'sales_target',
    'touchpoint_performance') NOT NULL;

ALTER TABLE import_batches
  MODIFY COLUMN report_type ENUM(
    'marketplace_sales_daily', 'marketplace_product_performance', 'marketplace_traffic',
    'meta_ads_performance', 'shopee_hsl_affiliate', 'product_master',
    'channel_listing_master', 'inventory_snapshot', 'event_costs', 'sales_target',
    'touchpoint_performance') NOT NULL;

-- GMV per listing per day split by the touchpoint that generated it.
-- cost = ad spend / affiliate commission / live cost for that touchpoint;
-- NULL = not reported (never treated as zero).
CREATE TABLE IF NOT EXISTS touchpoint_daily_facts (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  listing_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fact_date         DATE NOT NULL,
  touchpoint        ENUM('organik', 'iklan', 'afiliasi', 'live', 'video') NOT NULL,
  channel_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  gmv               BIGINT NOT NULL,
  orders            INT NOT NULL,
  units_sold        INT NOT NULL,
  cost              BIGINT NULL,
  source_batch_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_demo           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, listing_id, fact_date, touchpoint),
  KEY touchpoint_daily_facts_org_date_idx (organization_id, fact_date),
  KEY touchpoint_daily_facts_batch_idx (organization_id, source_batch_id),
  CONSTRAINT touchpoint_daily_facts_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT touchpoint_daily_facts_listing_fk FOREIGN KEY (organization_id, listing_id, channel_id)
    REFERENCES channel_listings (organization_id, id, channel_id) ON DELETE RESTRICT,
  CONSTRAINT touchpoint_daily_facts_batch_fk FOREIGN KEY (organization_id, source_batch_id)
    REFERENCES import_batches (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT touchpoint_daily_facts_nonneg CHECK (
    gmv >= 0 AND orders >= 0 AND units_sold >= 0 AND (cost IS NULL OR cost >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Portfolio matrix thresholds (Pengaturan → Organisasi):
--   high share  = SKU GMV share >= share_factor × (1 ÷ active SKUs)
--   high growth = MoM GMV growth >= growth_threshold (fraction; 0 = 0%)
SET @uci_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_kpi_settings'
      AND COLUMN_NAME = 'portfolio_share_factor') = 0,
  'ALTER TABLE organization_kpi_settings
     ADD COLUMN portfolio_share_factor DECIMAL(5,2) NOT NULL DEFAULT 1.00 AFTER default_range,
     ADD COLUMN portfolio_growth_threshold DECIMAL(6,4) NOT NULL DEFAULT 0.0000 AFTER portfolio_share_factor,
     ADD CONSTRAINT organization_kpi_settings_portfolio CHECK (
       portfolio_share_factor > 0 AND portfolio_share_factor <= 10
       AND portfolio_growth_threshold >= -1 AND portfolio_growth_threshold <= 10)',
  'DO 0');
PREPARE uci_stmt FROM @uci_sql;
EXECUTE uci_stmt;
DEALLOCATE PREPARE uci_stmt;
