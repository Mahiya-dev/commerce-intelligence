-- =============================================================================
-- 0007_organization_kpi_settings
-- Per-organization KPI settings, editable by the Owner (Pengaturan → Organisasi).
-- No row = application defaults (src/lib/organization/settings.ts).
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_kpi_settings (
  organization_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Target progress (GMV MTD ÷ expected MTD) thresholds, as fractions (0.9 = 90%).
  on_track_threshold      DECIMAL(5,4) NOT NULL DEFAULT 0.9000,
  watch_threshold         DECIMAL(5,4) NOT NULL DEFAULT 0.7000,
  -- Optional benchmarks; NULL = not set (never treated as zero).
  target_conversion_rate  DECIMAL(7,6) NULL,
  target_aov              BIGINT NULL,
  -- Date range used when Dashboard/E-Commerce open without ?range=.
  default_range           VARCHAR(16) NOT NULL DEFAULT 'mtd',
  updated_by              CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id),
  CONSTRAINT organization_kpi_settings_org_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT organization_kpi_settings_updated_by_fk FOREIGN KEY (updated_by)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT organization_kpi_settings_thresholds CHECK (
    watch_threshold > 0 AND watch_threshold < on_track_threshold AND on_track_threshold <= 2),
  CONSTRAINT organization_kpi_settings_conversion CHECK (
    target_conversion_rate IS NULL OR (target_conversion_rate > 0 AND target_conversion_rate <= 1)),
  CONSTRAINT organization_kpi_settings_aov CHECK (target_aov IS NULL OR target_aov > 0),
  CONSTRAINT organization_kpi_settings_range CHECK (
    default_range IN ('mtd', '7d', '30d', '90d', 'last_month'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
