-- =============================================================================
-- 0006_sales_facts
-- Canonical e-commerce facts, written ONLY by committing a validated import
-- batch (src/lib/imports/commit.ts). Every fact carries the batch it came
-- from; re-importing the same natural key overwrites it (latest batch wins).
--
--   sales_daily_facts    ← kinerja_toko_harian    org × channel × date
--   listing_daily_facts  ← kinerja_produk_harian  org × listing × date
--   sales_targets        ← target_bulanan         org × channel × month
--
-- Optional source columns stay NULL when the report did not provide them:
-- missing data is never stored as zero.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sales_daily_facts (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fact_date         DATE NOT NULL,
  gmv               BIGINT NOT NULL,
  orders            INT NOT NULL,
  units_sold        INT NOT NULL,
  visitors          INT NOT NULL,
  buyers            INT NULL,
  cancelled_orders  INT NULL,
  cancelled_gmv     BIGINT NULL,
  returned_gmv      BIGINT NULL,
  source_batch_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_demo           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, channel_id, fact_date),
  KEY sales_daily_facts_org_date_idx (organization_id, fact_date),
  KEY sales_daily_facts_batch_idx (organization_id, source_batch_id),
  CONSTRAINT sales_daily_facts_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT sales_daily_facts_channel_fk FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  CONSTRAINT sales_daily_facts_batch_fk FOREIGN KEY (organization_id, source_batch_id)
    REFERENCES import_batches (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_daily_facts_nonneg CHECK (
    gmv >= 0 AND orders >= 0 AND units_sold >= 0 AND visitors >= 0
    AND (buyers IS NULL OR buyers >= 0) AND (cancelled_orders IS NULL OR cancelled_orders >= 0)
    AND (cancelled_gmv IS NULL OR cancelled_gmv >= 0) AND (returned_gmv IS NULL OR returned_gmv >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tenant- and channel-consistent reference target for listing facts:
-- a fact can only point at a listing of the same organization AND channel.
SET @uci_sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_listings'
      AND INDEX_NAME = 'channel_listings_org_id_channel_key') = 0,
  'ALTER TABLE channel_listings ADD UNIQUE KEY channel_listings_org_id_channel_key (organization_id, id, channel_id)',
  'DO 0');
PREPARE uci_stmt FROM @uci_sql;
EXECUTE uci_stmt;
DEALLOCATE PREPARE uci_stmt;

-- channel_id duplicates channel_listings.channel_id for per-channel queries;
-- the composite FK below guarantees it matches the listing's channel.
CREATE TABLE IF NOT EXISTS listing_daily_facts (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  listing_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fact_date         DATE NOT NULL,
  channel_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  gmv               BIGINT NOT NULL,
  orders            INT NOT NULL,
  units_sold        INT NOT NULL,
  product_visitors  INT NULL,
  product_clicks    INT NULL,
  cancelled_orders  INT NULL,
  source_batch_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_demo           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, listing_id, fact_date),
  KEY listing_daily_facts_org_date_idx (organization_id, fact_date),
  KEY listing_daily_facts_channel_idx (organization_id, channel_id, fact_date),
  KEY listing_daily_facts_batch_idx (organization_id, source_batch_id),
  CONSTRAINT listing_daily_facts_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT listing_daily_facts_listing_fk FOREIGN KEY (organization_id, listing_id, channel_id)
    REFERENCES channel_listings (organization_id, id, channel_id) ON DELETE RESTRICT,
  CONSTRAINT listing_daily_facts_batch_fk FOREIGN KEY (organization_id, source_batch_id)
    REFERENCES import_batches (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT listing_daily_facts_nonneg CHECK (
    gmv >= 0 AND orders >= 0 AND units_sold >= 0
    AND (product_visitors IS NULL OR product_visitors >= 0) AND (product_clicks IS NULL OR product_clicks >= 0)
    AND (cancelled_orders IS NULL OR cancelled_orders >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- target_month is the first day of the month (YYYY-MM-01).
CREATE TABLE IF NOT EXISTS sales_targets (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_month      DATE NOT NULL,
  target_gmv        BIGINT NOT NULL,
  target_orders     INT NULL,
  note              VARCHAR(255) NULL,
  source_batch_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_demo           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, channel_id, target_month),
  KEY sales_targets_batch_idx (organization_id, source_batch_id),
  CONSTRAINT sales_targets_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT sales_targets_channel_fk FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  CONSTRAINT sales_targets_batch_fk FOREIGN KEY (organization_id, source_batch_id)
    REFERENCES import_batches (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_targets_first_day CHECK (DAYOFMONTH(target_month) = 1),
  CONSTRAINT sales_targets_positive CHECK (target_gmv > 0 AND (target_orders IS NULL OR target_orders > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
