-- =============================================================================
-- 0011_events (Phase 5 — Profitabilitas Event)
--
--   variant_cogs_history  versioned unit COGS (effective from a date); falls back
--                         to product_variants.standard_cogs; bundles use components
--   events                event master
--   event_sales           units & net revenue per SKU, during the event or post-event
--   event_costs           fixed / variable costs
--   event_leads           lead counts (aggregated — no personal data stored)
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_cogs_history (
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  variant_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effective_from   DATE NOT NULL,
  unit_cogs        DECIMAL(18, 2) NOT NULL,
  note             VARCHAR(255) NULL,
  created_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, variant_id, effective_from),
  CONSTRAINT variant_cogs_history_variant_fk FOREIGN KEY (organization_id, variant_id)
    REFERENCES product_variants (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT variant_cogs_history_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT variant_cogs_history_positive CHECK (unit_cogs >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name              VARCHAR(200) NOT NULL,
  kind              ENUM('bazar', 'pameran', 'sponsorship', 'pop_up', 'online', 'lainnya') NOT NULL,
  location          VARCHAR(200) NULL,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  status            ENUM('rencana', 'berlangsung', 'selesai', 'batal') NOT NULL DEFAULT 'rencana',
  -- Post-event sales count toward the event for this many days after end_date.
  attribution_days  INT NOT NULL DEFAULT 30,
  notes             VARCHAR(1000) NULL,
  is_demo           TINYINT(1) NOT NULL DEFAULT 0,
  created_by        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY events_org_id_key (organization_id, id),
  KEY events_org_start_idx (organization_id, start_date),
  CONSTRAINT events_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT events_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT events_dates CHECK (start_date <= end_date),
  CONSTRAINT events_attribution CHECK (attribution_days BETWEEN 0 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_sales (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  variant_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sold_on          DATE NOT NULL,
  units            INT NOT NULL,
  -- Net revenue actually received (after discounts), whole rupiah.
  revenue          BIGINT NOT NULL,
  phase            ENUM('event', 'pasca_event') NOT NULL DEFAULT 'event',
  note             VARCHAR(255) NULL,
  created_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY event_sales_event_idx (organization_id, event_id),
  CONSTRAINT event_sales_event_fk FOREIGN KEY (organization_id, event_id)
    REFERENCES events (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sales_variant_fk FOREIGN KEY (organization_id, variant_id)
    REFERENCES product_variants (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT event_sales_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT event_sales_positive CHECK (units > 0 AND revenue >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_costs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category         ENUM('sewa_booth', 'transport', 'akomodasi', 'tenaga_kerja', 'konsumsi', 'promosi', 'sampel',
                        'perlengkapan', 'lainnya') NOT NULL,
  -- tetap = does not change with sales (booth); variabel = grows with sales (commission, packaging).
  cost_type        ENUM('tetap', 'variabel') NOT NULL,
  amount           BIGINT NOT NULL,
  incurred_on      DATE NULL,
  note             VARCHAR(255) NULL,
  created_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY event_costs_event_idx (organization_id, event_id),
  CONSTRAINT event_costs_event_fk FOREIGN KEY (organization_id, event_id)
    REFERENCES events (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT event_costs_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT event_costs_positive CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_leads (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  captured_on      DATE NOT NULL,
  source           ENUM('form', 'qr', 'whatsapp', 'kartu_nama', 'lainnya') NOT NULL,
  leads            INT NOT NULL,
  converted        INT NOT NULL DEFAULT 0,
  note             VARCHAR(255) NULL,
  created_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY event_leads_event_idx (organization_id, event_id),
  CONSTRAINT event_leads_event_fk FOREIGN KEY (organization_id, event_id)
    REFERENCES events (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT event_leads_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT event_leads_counts CHECK (leads > 0 AND converted >= 0 AND converted <= leads)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
