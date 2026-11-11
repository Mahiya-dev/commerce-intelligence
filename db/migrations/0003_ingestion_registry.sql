-- =============================================================================
-- 0003_ingestion_registry
-- Foundations for the Excel/CSV ingestion pipeline (logic arrives in Phase 2).
-- =============================================================================

CREATE TABLE IF NOT EXISTS data_mapping_profiles (
  id               CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- '' = applies to any channel (avoids NULL in the unique key).
  channel_code     VARCHAR(40) NOT NULL DEFAULT '',
  report_type      ENUM(
                     'marketplace_sales_daily', 'marketplace_product_performance', 'marketplace_traffic',
                     'meta_ads_performance', 'shopee_hsl_affiliate', 'product_master',
                     'channel_listing_master', 'inventory_snapshot', 'event_costs') NOT NULL,
  name             VARCHAR(120) NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  -- {"Tanggal": "date", "Total Penjualan (IDR)": "gmv", ...}
  column_map       JSON NOT NULL,
  date_format      VARCHAR(32) NOT NULL DEFAULT 'DD/MM/YYYY',
  number_locale    ENUM('id-ID', 'en-US') NOT NULL DEFAULT 'id-ID',
  is_active        TINYINT(1) NOT NULL DEFAULT 1,
  created_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY data_mapping_profiles_version_key (organization_id, channel_code, report_type, version),
  UNIQUE KEY data_mapping_profiles_org_id_key (organization_id, id),
  CONSTRAINT data_mapping_profiles_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT data_mapping_profiles_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT data_mapping_profiles_version_min CHECK (version >= 1),
  CONSTRAINT data_mapping_profiles_column_map_object CHECK (JSON_TYPE(column_map) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_batches (
  id                  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  report_type         ENUM(
                        'marketplace_sales_daily', 'marketplace_product_performance', 'marketplace_traffic',
                        'meta_ads_performance', 'shopee_hsl_affiliate', 'product_master',
                        'channel_listing_master', 'inventory_snapshot', 'event_costs') NOT NULL,
  mapping_profile_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source_file_name    VARCHAR(255) NOT NULL,
  -- Path relative to the private upload directory (outside public_html).
  storage_path        VARCHAR(500) NULL,
  mime_type           VARCHAR(100) NOT NULL,
  file_size_bytes     BIGINT NOT NULL,
  -- VARCHAR (not CHAR): MariaDB forbids CHAR in generated-column expressions
  -- because CHAR padding depends on sql_mode.
  file_sha256         VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status              ENUM('uploaded', 'validating', 'validated', 'committing', 'committed', 'failed', 'cancelled')
                        NOT NULL DEFAULT 'uploaded',
  period_start        DATE NULL,
  period_end          DATE NULL,
  total_rows          INT NULL,
  valid_rows          INT NULL,
  invalid_rows        INT NULL,
  error_message       TEXT NULL,
  is_demo             TINYINT(1) NOT NULL DEFAULT 0,
  created_by          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  committed_by        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  committed_at        DATETIME(3) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- Duplicate-file detection: same content + report type cannot be active twice.
  -- NULL for cancelled/failed batches, so a re-import is allowed afterwards.
  dedupe_sha256       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin
                        AS (IF(status IN ('cancelled', 'failed'), NULL, file_sha256)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY import_batches_org_id_key (organization_id, id),
  UNIQUE KEY import_batches_dedupe_key (organization_id, report_type, dedupe_sha256),
  KEY import_batches_org_created_idx (organization_id, created_at),
  CONSTRAINT import_batches_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT import_batches_channel_fk FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  CONSTRAINT import_batches_profile_fk FOREIGN KEY (organization_id, mapping_profile_id)
    REFERENCES data_mapping_profiles (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT import_batches_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT import_batches_committed_by_fk FOREIGN KEY (committed_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT import_batches_mime CHECK (mime_type IN (
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  CONSTRAINT import_batches_size CHECK (file_size_bytes > 0 AND file_size_bytes <= 26214400),
  CONSTRAINT import_batches_sha CHECK (file_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT import_batches_period CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  CONSTRAINT import_batches_committed_pair CHECK ((status = 'committed') = (committed_at IS NOT NULL)),
  CONSTRAINT import_batches_counts CHECK (
    (total_rows IS NULL OR total_rows >= 0) AND (valid_rows IS NULL OR valid_rows >= 0)
    AND (invalid_rows IS NULL OR invalid_rows >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_rows (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  batch_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_row       INT NOT NULL,
  raw              JSON NOT NULL,
  normalized       JSON NULL,
  status           ENUM('pending', 'valid', 'invalid', 'skipped', 'committed') NOT NULL DEFAULT 'pending',
  -- [{"column": "GMV", "code": "invalid_number", "message": "..."}]
  errors           JSON NOT NULL,
  -- Natural key of the canonical fact this row maps to (idempotent upserts).
  natural_key      VARCHAR(255) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY import_rows_batch_row_key (batch_id, source_row),
  KEY import_rows_batch_status_idx (batch_id, status),
  CONSTRAINT import_rows_batch_fk FOREIGN KEY (organization_id, batch_id)
    REFERENCES import_batches (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT import_rows_row_number_min CHECK (source_row >= 1),
  CONSTRAINT import_rows_errors_array CHECK (JSON_TYPE(errors) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
