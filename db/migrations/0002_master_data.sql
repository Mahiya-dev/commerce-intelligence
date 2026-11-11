-- =============================================================================
-- 0002_master_data
-- Channel catalogue, product master (products, variants/SKUs, bundles) and
-- channel-specific listing mapping. Composite FKs (organization_id, id) make
-- cross-organization references impossible at the database level.
-- =============================================================================

CREATE TABLE IF NOT EXISTS channels (
  id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code        VARCHAR(40)  NOT NULL,
  name        VARCHAR(80)  NOT NULL,
  kind        ENUM('marketplace', 'advertising', 'affiliate', 'offline') NOT NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order  SMALLINT     NOT NULL DEFAULT 100,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY channels_code_key (code),
  CONSTRAINT channels_code_format CHECK (
    CAST(code AS BINARY) = CAST(LOWER(code) AS BINARY) AND code REGEXP '^[a-z][a-z0-9_]{1,39}$'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reference rows are part of the schema contract (fixed IDs for portability).
INSERT IGNORE INTO channels (id, code, name, kind, sort_order) VALUES
  ('0c0a0000-0000-4000-8000-000000000001', 'shopee',        'Shopee',                 'marketplace', 10),
  ('0c0a0000-0000-4000-8000-000000000002', 'tiktok_shop',   'TikTok Shop',            'marketplace', 20),
  ('0c0a0000-0000-4000-8000-000000000003', 'tokopedia',     'Tokopedia',              'marketplace', 30),
  ('0c0a0000-0000-4000-8000-000000000004', 'meta_ads',      'Meta Ads',               'advertising', 40),
  ('0c0a0000-0000-4000-8000-000000000005', 'shopee_hsl',    'Shopee HSL (Affiliate)', 'affiliate',   50),
  ('0c0a0000-0000-4000-8000-000000000006', 'offline_event', 'Event / Offline',        'offline',     60);

CREATE TABLE IF NOT EXISTS products (
  id               CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code             VARCHAR(64)  NOT NULL,
  name             VARCHAR(200) NOT NULL,
  category         VARCHAR(80)  NULL,
  brand            VARCHAR(80)  NULL,
  product_type     ENUM('single', 'bundle') NOT NULL DEFAULT 'single',
  status           ENUM('active', 'inactive', 'discontinued') NOT NULL DEFAULT 'active',
  launched_on      DATE NULL,
  is_demo          TINYINT(1)   NOT NULL DEFAULT 0,
  created_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY products_org_code_key (organization_id, code),
  UNIQUE KEY products_org_id_key (organization_id, id),
  KEY products_org_status_idx (organization_id, status),
  CONSTRAINT products_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT products_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT products_code_format CHECK (code REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  CONSTRAINT products_name_len CHECK (CHAR_LENGTH(name) >= 2)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_variants (
  id               CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sku              VARCHAR(64)  NOT NULL,
  name             VARCHAR(200) NOT NULL,
  size_value       DECIMAL(12, 3) NULL,
  size_unit        ENUM('g', 'kg', 'ml', 'l', 'pcs') NULL,
  barcode          VARCHAR(64)  NULL,
  -- Standard unit COGS in organization currency. Versioned history: Phase 5.
  standard_cogs    DECIMAL(18, 2) NULL,
  status           ENUM('active', 'inactive', 'discontinued') NOT NULL DEFAULT 'active',
  is_demo          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY product_variants_org_sku_key (organization_id, sku),
  UNIQUE KEY product_variants_org_id_key (organization_id, id),
  UNIQUE KEY product_variants_org_barcode_key (organization_id, barcode),
  KEY product_variants_product_idx (organization_id, product_id),
  CONSTRAINT product_variants_product_fk FOREIGN KEY (organization_id, product_id)
    REFERENCES products (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT product_variants_sku_format CHECK (sku REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  CONSTRAINT product_variants_size_positive CHECK (size_value IS NULL OR size_value > 0),
  CONSTRAINT product_variants_size_pair CHECK ((size_value IS NULL) = (size_unit IS NULL)),
  CONSTRAINT product_variants_cogs_nonneg CHECK (standard_cogs IS NULL OR standard_cogs >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bundle composition. Rules "parent must be a bundle product" and "no nested
-- bundles" are enforced in src/lib/master-data/bundles.ts.
CREATE TABLE IF NOT EXISTS bundle_components (
  organization_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bundle_variant_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  component_variant_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity              INT NOT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (bundle_variant_id, component_variant_id),
  KEY bundle_components_component_idx (organization_id, component_variant_id),
  -- RESTRICT (not CASCADE) so the CHECK below is allowed on MySQL; remove
  -- bundle rows explicitly before deleting a variant.
  CONSTRAINT bundle_components_bundle_fk FOREIGN KEY (organization_id, bundle_variant_id)
    REFERENCES product_variants (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT bundle_components_component_fk FOREIGN KEY (organization_id, component_variant_id)
    REFERENCES product_variants (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT bundle_components_quantity_range CHECK (quantity BETWEEN 1 AND 1000),
  CONSTRAINT bundle_components_not_self CHECK (bundle_variant_id <> component_variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Marketplace listing <-> internal SKU mapping. A listing may be unmapped
-- (variant_id NULL) until a user maps it. external_sku_id uses '' (not NULL)
-- for "no SKU-level id" so the unique key also catches duplicates.
CREATE TABLE IF NOT EXISTS channel_listings (
  id                   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_product_id  VARCHAR(128) NOT NULL,
  external_sku_id      VARCHAR(128) NOT NULL DEFAULT '',
  listing_name         VARCHAR(255) NOT NULL,
  listing_url          VARCHAR(500) NULL,
  variant_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Units of variant_id contained in one unit sold of this listing ("Isi 2").
  units_per_listing    INT NOT NULL DEFAULT 1,
  mapping_source       ENUM('auto', 'manual') NULL,
  mapped_by            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  mapped_at            DATETIME(3) NULL,
  status               ENUM('active', 'inactive', 'delisted') NOT NULL DEFAULT 'active',
  is_demo              TINYINT(1) NOT NULL DEFAULT 0,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY channel_listings_external_key (organization_id, channel_id, external_product_id, external_sku_id),
  KEY channel_listings_variant_idx (organization_id, variant_id),
  KEY channel_listings_channel_idx (channel_id),
  CONSTRAINT channel_listings_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT channel_listings_channel_fk FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  -- Mapped variants cannot be deleted; deactivate them or unmap listings first.
  CONSTRAINT channel_listings_variant_fk FOREIGN KEY (organization_id, variant_id)
    REFERENCES product_variants (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT channel_listings_mapped_by_fk FOREIGN KEY (mapped_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT channel_listings_ext_product_len CHECK (CHAR_LENGTH(external_product_id) >= 1),
  CONSTRAINT channel_listings_url_scheme CHECK (listing_url IS NULL OR listing_url LIKE 'http://%' OR listing_url LIKE 'https://%'),
  CONSTRAINT channel_listings_units_range CHECK (units_per_listing BETWEEN 1 AND 1000),
  CONSTRAINT channel_listings_mapping_pair CHECK ((variant_id IS NULL) = (mapping_source IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
