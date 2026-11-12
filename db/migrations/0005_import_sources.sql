-- =============================================================================
-- 0005_import_sources
-- Import sources (pick one per batch): file upload (Excel/CSV), Google Sheets,
-- or a marketplace API connection; plus the monthly target report type.
-- Re-runnable: ENUM redefinitions are idempotent, new columns are added only
-- when missing (MySQL 8 has no ADD COLUMN IF NOT EXISTS).
-- =============================================================================

ALTER TABLE data_mapping_profiles
  MODIFY COLUMN report_type ENUM(
    'marketplace_sales_daily', 'marketplace_product_performance', 'marketplace_traffic',
    'meta_ads_performance', 'shopee_hsl_affiliate', 'product_master',
    'channel_listing_master', 'inventory_snapshot', 'event_costs', 'sales_target') NOT NULL;

ALTER TABLE import_batches
  MODIFY COLUMN report_type ENUM(
    'marketplace_sales_daily', 'marketplace_product_performance', 'marketplace_traffic',
    'meta_ads_performance', 'shopee_hsl_affiliate', 'product_master',
    'channel_listing_master', 'inventory_snapshot', 'event_costs', 'sales_target') NOT NULL;

SET @uci_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_batches' AND COLUMN_NAME = 'source_kind') = 0,
  'ALTER TABLE import_batches
     ADD COLUMN source_kind ENUM(''file_upload'', ''google_sheets'', ''marketplace_api'') NOT NULL DEFAULT ''file_upload''
       AFTER mapping_profile_id,
     ADD COLUMN source_ref VARCHAR(500) NULL AFTER source_kind',
  'DO 0');
PREPARE uci_stmt FROM @uci_sql;
EXECUTE uci_stmt;
DEALLOCATE PREPARE uci_stmt;
