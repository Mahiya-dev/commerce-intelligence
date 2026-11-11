-- =============================================================================
-- 0001_core_tenancy_auth
-- Organizations, users (local authentication), memberships with roles,
-- server-side sessions and login-attempt tracking.
--
-- Target: MySQL 8.0.16+ or MariaDB 10.6+ (cPanel). InnoDB, utf8mb4.
-- Portability rules for ALL migrations in this folder:
--   * No triggers / stored functions (shared hosting with binlog rejects them).
--   * No partial indexes; use STORED generated columns instead. Generated
--     expressions must not use CHAR columns (MariaDB): use VARCHAR.
--   * CHECK constraints must not reference FK columns that use CASCADE/SET NULL
--     (MySQL restriction).
--   * Case-sensitive checks use CAST(x AS BINARY) (columns use a _ci collation).
--   * IDs are UUID strings: CHAR(36) CHARACTER SET ascii COLLATE ascii_bin.
--   * MySQL DDL is NOT transactional: every statement must be re-runnable
--     (CREATE TABLE IF NOT EXISTS, INSERT IGNORE) so a fixed migration can be
--     re-applied after a partial failure.
--   * Avoid reserved words as identifiers (e.g. row_number, rank, groups).
-- Business invariants that cannot be expressed here (audit trail, "at least one
-- active owner", bundle rules, tenant isolation) are enforced in src/lib/** and
-- covered by integration tests.
-- =============================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(64)  NOT NULL,
  timezone    VARCHAR(64)  NOT NULL DEFAULT 'Asia/Jakarta',
  currency    CHAR(3)      NOT NULL DEFAULT 'IDR',
  -- 1 = synthetic demo tenant; UI must label all of its data as DEMO.
  is_demo     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY organizations_slug_key (slug),
  CONSTRAINT organizations_name_len CHECK (CHAR_LENGTH(name) BETWEEN 2 AND 120),
  CONSTRAINT organizations_slug_format CHECK (
    CAST(slug AS BINARY) = CAST(LOWER(slug) AS BINARY)
    AND slug REGEXP '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'
  ),
  CONSTRAINT organizations_currency_format CHECK (CAST(currency AS BINARY) = CAST(UPPER(currency) AS BINARY)),
  CONSTRAINT organizations_is_demo_bool CHECK (is_demo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id                    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email                 VARCHAR(254) NOT NULL,
  full_name             VARCHAR(120) NULL,
  -- Self-describing hash: scrypt$N$r$p$salt$hash (see src/lib/auth/password.ts)
  password_hash         VARCHAR(255) NOT NULL,
  must_change_password  TINYINT(1)   NOT NULL DEFAULT 1,
  status                ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  last_login_at         DATETIME(3)  NULL,
  password_changed_at   DATETIME(3)  NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY users_email_key (email),
  CONSTRAINT users_email_lowercase CHECK (CAST(email AS BINARY) = CAST(LOWER(email) AS BINARY)),
  CONSTRAINT users_email_shape CHECK (email LIKE '_%@_%._%'),
  CONSTRAINT users_password_hash_scheme CHECK (password_hash LIKE 'scrypt$%'),
  CONSTRAINT users_must_change_bool CHECK (must_change_password IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Role order matters and is mirrored in src/lib/auth/roles.ts:
-- viewer < analyst < admin < owner.
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role             ENUM('viewer', 'analyst', 'admin', 'owner') NOT NULL DEFAULT 'viewer',
  status           ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  invited_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (organization_id, user_id),
  KEY organization_members_user_idx (user_id),
  CONSTRAINT organization_members_org_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT organization_members_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT organization_members_invited_by_fk FOREIGN KEY (invited_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side sessions. The cookie holds a random token; only its SHA-256
-- hash is stored, so a database leak does not leak usable session tokens.
CREATE TABLE IF NOT EXISTS sessions (
  id                   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id              CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  idle_expires_at      DATETIME(3) NOT NULL,
  absolute_expires_at  DATETIME(3) NOT NULL,
  ip_address           VARCHAR(45) NULL,
  user_agent           VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY sessions_user_idx (user_id),
  KEY sessions_expiry_idx (absolute_expires_at),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Brute-force protection. Email is stored as a SHA-256 hash, never in clear.
CREATE TABLE IF NOT EXISTS login_attempts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ip_address    VARCHAR(45) NULL,
  succeeded     TINYINT(1) NOT NULL,
  attempted_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY login_attempts_email_idx (email_hash, attempted_at),
  KEY login_attempts_ip_idx (ip_address, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
