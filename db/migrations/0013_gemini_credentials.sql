-- =============================================================================
-- 0013_gemini_credentials
-- Gemini API key entered by the Owner (Pengaturan → Organisasi), stored
-- encrypted in organization_ai_credentials like the Groq key (0008).
-- Re-runnable: redefining the ENUM is idempotent.
-- =============================================================================

ALTER TABLE organization_ai_credentials
  MODIFY COLUMN provider ENUM('groq', 'gemini') NOT NULL;
