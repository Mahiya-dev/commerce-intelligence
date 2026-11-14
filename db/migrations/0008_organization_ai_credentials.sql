-- =============================================================================
-- 0008_organization_ai_credentials
-- AI provider credentials entered by the Owner (Pengaturan → Organisasi).
-- The API key is stored ENCRYPTED (AES-256-GCM, APP_ENCRYPTION_KEY in the server
-- environment; src/lib/crypto/secret-box.ts) and never sent back to the browser.
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_ai_credentials (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider          ENUM('groq') NOT NULL,
  -- "v1:" + base64(iv | tag | ciphertext); bound to organization_id + provider.
  encrypted_key     VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Non-secret display hint, e.g. "gsk_…a1b2".
  key_hint          VARCHAR(16) NOT NULL,
  -- Model id chosen by the Owner; NULL = decided when the AI Analyst is built.
  model             VARCHAR(128) NULL,
  last_verified_at  DATETIME(3) NULL,
  updated_by        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, provider),
  CONSTRAINT organization_ai_credentials_org_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT organization_ai_credentials_updated_by_fk FOREIGN KEY (updated_by)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT organization_ai_credentials_format CHECK (encrypted_key LIKE 'v1:%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
