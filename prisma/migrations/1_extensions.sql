-- ============================================
-- Install PostgreSQL extensions required by AIMS Commerce
-- ============================================
-- Apply this file BEFORE the migration:
--   psql "$DIRECT_URL" -f 1_extensions.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
