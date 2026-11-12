-- =============================================================================
-- 0007_ai_insights
-- AI-generated insights (src/lib/ai/insights.ts) and the request log used for
-- rate limiting and cost tracking. Rate limits live in MySQL because
-- Passenger may run several app processes.
--
-- ai_insights.input keeps the exact metrics sent to the model, so every
-- insight can be traced back to (and reproduced from) its evidence.
-- data_fingerprint = SHA-256 of that input: one insight per data version.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_insights (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind              ENUM('dashboard_ecommerce') NOT NULL,
  data_fingerprint  VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  as_of             DATE NOT NULL,
  provider          VARCHAR(32) NOT NULL,
  model             VARCHAR(100) NOT NULL,
  input             JSON NOT NULL,
  output            JSON NOT NULL,
  is_demo           TINYINT(1) NOT NULL DEFAULT 0,
  created_by        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ai_insights_latest_idx (organization_id, kind, created_at),
  KEY ai_insights_fingerprint_idx (organization_id, kind, data_fingerprint),
  CONSTRAINT ai_insights_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT ai_insights_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT ai_insights_fingerprint_hex CHECK (data_fingerprint REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ai_insights_output_object CHECK (JSON_TYPE(output) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_requests (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  kind               VARCHAR(40) NOT NULL,
  provider           VARCHAR(32) NOT NULL,
  model              VARCHAR(100) NOT NULL,
  status             ENUM('ok', 'error', 'invalid') NOT NULL,
  error_code         VARCHAR(40) NULL,
  prompt_tokens      INT NULL,
  completion_tokens  INT NULL,
  latency_ms         INT NOT NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ai_requests_org_created_idx (organization_id, created_at),
  KEY ai_requests_user_created_idx (user_id, created_at),
  CONSTRAINT ai_requests_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT ai_requests_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT ai_requests_nonneg CHECK (
    latency_ms >= 0 AND (prompt_tokens IS NULL OR prompt_tokens >= 0)
    AND (completion_tokens IS NULL OR completion_tokens >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
