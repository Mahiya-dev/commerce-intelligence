-- =============================================================================
-- 0004_audit_logs
-- Append-only audit trail, written by the application in the SAME transaction
-- as the change it records (see src/lib/audit.ts). The app DB user only ever
-- INSERTs into this table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_user_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- e.g. auth.login, auth.login_failed, member.role_changed, product.created
  action           VARCHAR(64) NOT NULL,
  entity_type      VARCHAR(64) NOT NULL,
  entity_id        VARCHAR(128) NULL,
  old_data         JSON NULL,
  new_data         JSON NULL,
  ip_address       VARCHAR(45) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY audit_logs_org_created_idx (organization_id, created_at),
  KEY audit_logs_entity_idx (entity_type, entity_id),
  CONSTRAINT audit_logs_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT audit_logs_actor_fk FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
