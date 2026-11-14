-- =============================================================================
-- 0012_affiliates (Phase 5 — Afiliasi HSL)
--
--   affiliates           master (auto-created from HSL imports by username)
--   hsl_sales_facts      ← penjualan_hsl   org × affiliate × listing × date (Shopee)
--   inventory_movements  stock ledger: warehouse in/adjust, allocation to and return
--                        from affiliates (locked stock = allocated − returned − HSL sold)
--   hsl_allocations      proposed → approved (human) → applied; never above stock
-- Plus the allocation settings on organization_kpi_settings.
-- =============================================================================

CREATE TABLE IF NOT EXISTS affiliates (
  id               CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  username         VARCHAR(64) NOT NULL,
  name             VARCHAR(200) NOT NULL,
  status           ENUM('aktif', 'nonaktif') NOT NULL DEFAULT 'aktif',
  notes            VARCHAR(1000) NULL,
  is_demo          TINYINT(1) NOT NULL DEFAULT 0,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY affiliates_org_id_key (organization_id, id),
  UNIQUE KEY affiliates_username_key (organization_id, username),
  CONSTRAINT affiliates_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hsl_sales_facts (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  affiliate_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  listing_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fact_date         DATE NOT NULL,
  channel_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  units_sold        INT NOT NULL,
  gmv               BIGINT NOT NULL,
  commission        BIGINT NULL,
  source_batch_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_demo           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, affiliate_id, listing_id, fact_date),
  KEY hsl_sales_facts_org_date_idx (organization_id, fact_date),
  KEY hsl_sales_facts_batch_idx (organization_id, source_batch_id),
  CONSTRAINT hsl_sales_facts_affiliate_fk FOREIGN KEY (organization_id, affiliate_id)
    REFERENCES affiliates (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT hsl_sales_facts_listing_fk FOREIGN KEY (organization_id, listing_id, channel_id)
    REFERENCES channel_listings (organization_id, id, channel_id) ON DELETE RESTRICT,
  CONSTRAINT hsl_sales_facts_batch_fk FOREIGN KEY (organization_id, source_batch_id)
    REFERENCES import_batches (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT hsl_sales_facts_nonneg CHECK (
    units_sold >= 0 AND gmv >= 0 AND (commission IS NULL OR commission >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hsl_allocations (
  id               CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  affiliate_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  variant_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status           ENUM('diusulkan', 'disetujui', 'diterapkan', 'ditolak') NOT NULL DEFAULT 'diusulkan',
  proposed_qty     INT NOT NULL,
  approved_qty     INT NULL,
  -- Inputs of the recommendation (velocity, cover days, locked, target, available) for traceability.
  basis            JSON NULL,
  note             VARCHAR(255) NULL,
  proposed_by      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  proposed_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decided_at       DATETIME(3) NULL,
  applied_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  applied_at       DATETIME(3) NULL,
  is_demo          TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY hsl_allocations_org_id_key (organization_id, id),
  KEY hsl_allocations_status_idx (organization_id, status),
  CONSTRAINT hsl_allocations_affiliate_fk FOREIGN KEY (organization_id, affiliate_id)
    REFERENCES affiliates (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT hsl_allocations_variant_fk FOREIGN KEY (organization_id, variant_id)
    REFERENCES product_variants (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT hsl_allocations_proposed_by_fk FOREIGN KEY (proposed_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT hsl_allocations_decided_by_fk FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT hsl_allocations_applied_by_fk FOREIGN KEY (applied_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT hsl_allocations_qty CHECK (proposed_qty > 0 AND (approved_qty IS NULL OR approved_qty > 0)),
  CONSTRAINT hsl_allocations_approved CHECK (status IN ('diusulkan', 'ditolak') OR approved_qty IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- quantity is always positive; the movement type gives the direction:
--   masuk        warehouse +    (affiliate_id NULL)
--   penyesuaian  warehouse ±    (direction in sign_adjust: +1 / −1)
--   alokasi      warehouse −, affiliate +
--   retur        affiliate −, warehouse +
CREATE TABLE IF NOT EXISTS inventory_movements (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  variant_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  affiliate_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  movement_type    ENUM('masuk', 'penyesuaian', 'alokasi', 'retur') NOT NULL,
  quantity         INT NOT NULL,
  sign_adjust      TINYINT NOT NULL DEFAULT 1,
  occurred_on      DATE NOT NULL,
  allocation_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  note             VARCHAR(255) NULL,
  created_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  is_demo          TINYINT(1) NOT NULL DEFAULT 0,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY inventory_movements_variant_idx (organization_id, variant_id),
  KEY inventory_movements_affiliate_idx (organization_id, affiliate_id),
  CONSTRAINT inventory_movements_variant_fk FOREIGN KEY (organization_id, variant_id)
    REFERENCES product_variants (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movements_affiliate_fk FOREIGN KEY (organization_id, affiliate_id)
    REFERENCES affiliates (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movements_allocation_fk FOREIGN KEY (organization_id, allocation_id)
    REFERENCES hsl_allocations (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movements_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT inventory_movements_qty CHECK (quantity > 0 AND sign_adjust IN (-1, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @uci_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_kpi_settings'
      AND COLUMN_NAME = 'allocation_cover_days') = 0,
  'ALTER TABLE organization_kpi_settings
     ADD COLUMN allocation_cover_days INT NOT NULL DEFAULT 14 AFTER portfolio_growth_threshold,
     ADD COLUMN velocity_window_days INT NOT NULL DEFAULT 14 AFTER allocation_cover_days,
     ADD CONSTRAINT organization_kpi_settings_allocation CHECK (
       allocation_cover_days BETWEEN 1 AND 90 AND velocity_window_days BETWEEN 7 AND 90)',
  'DO 0');
PREPARE uci_stmt FROM @uci_sql;
EXECUTE uci_stmt;
DEALLOCATE PREPARE uci_stmt;
