-- ============================================
-- Chat tables for Supabase Realtime
-- Replaces Socket.IO chat in backend/server.js
-- ============================================

-- Live presence: which users are online right now
-- Updated on login, marked offline on disconnect/tab close
CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id"          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     UUID         NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_name"   VARCHAR(255) NOT NULL,
  "user_email"  VARCHAR(255) NOT NULL,
  "is_admin"    BOOLEAN      NOT NULL DEFAULT false,
  "online"      BOOLEAN      NOT NULL DEFAULT true,
  "last_seen"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One session row per user; upsert on login replaces the old one
CREATE UNIQUE INDEX IF NOT EXISTS "chat_sessions_user_id_key" ON "chat_sessions"("user_id");
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_online" ON "chat_sessions"("online");
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_admin"  ON "chat_sessions"("is_admin");

-- Persistent message log (also drives the realtime feed)
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id"            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "sender_id"     UUID         NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sender_name"   VARCHAR(255) NOT NULL,
  "is_admin"      BOOLEAN      NOT NULL DEFAULT false,
  "recipient_id"  UUID         REFERENCES "users"("id") ON DELETE CASCADE, -- NULL = broadcast to all online admins
  "body"          TEXT         NOT NULL,
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_chat_messages_sender"     ON "chat_messages"("sender_id");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_recipient"  ON "chat_messages"("recipient_id");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_created_at" ON "chat_messages"("created_at" DESC);

-- ============================================
-- RLS: chat_sessions
-- ============================================
ALTER TABLE "chat_sessions" ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read all sessions (admin dashboard needs the list)
DROP POLICY IF EXISTS "chat_sessions_read" ON "chat_sessions";
CREATE POLICY "chat_sessions_read" ON "chat_sessions"
  FOR SELECT USING (auth.role() = 'authenticated');

-- Anyone authenticated can insert (login)
DROP POLICY IF EXISTS "chat_sessions_insert" ON "chat_sessions";
CREATE POLICY "chat_sessions_insert" ON "chat_sessions"
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Anyone authenticated can update (heartbeat / disconnect)
DROP POLICY IF EXISTS "chat_sessions_update" ON "chat_sessions";
CREATE POLICY "chat_sessions_update" ON "chat_sessions"
  FOR UPDATE USING (auth.role() = 'authenticated');

-- ============================================
-- RLS: chat_messages
-- ============================================
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read all messages (admin can see all user messages; users can see messages addressed to them)
DROP POLICY IF EXISTS "chat_messages_read" ON "chat_messages";
CREATE POLICY "chat_messages_read" ON "chat_messages"
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only authenticated users can send; sender_id is forced server-side via API route
DROP POLICY IF EXISTS "chat_messages_insert" ON "chat_messages";
CREATE POLICY "chat_messages_insert" ON "chat_messages"
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- Trigger: keep updated_at fresh on chat_sessions
-- ============================================
CREATE OR REPLACE FUNCTION touch_chat_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updated_at" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trigger_touch_chat_sessions" ON "chat_sessions";
CREATE TRIGGER "trigger_touch_chat_sessions"
  BEFORE UPDATE ON "chat_sessions"
  FOR EACH ROW EXECUTE FUNCTION touch_chat_sessions_updated_at();

-- ============================================
-- Realtime: enable broadcast on the two tables
-- Supabase Realtime listens to postgres_changes
-- ============================================
-- Note: publication `supabase_realtime` is auto-created by Supabase.
-- These ALTERs are no-ops if the publication doesn't exist yet, which
-- is fine — the migration will succeed and the tables will be picked
-- up when Supabase auto-discovers them.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE "chat_sessions";
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'Publication supabase_realtime does not exist yet — chat_sessions will be auto-added';
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE "chat_messages";
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'Publication supabase_realtime does not exist yet — chat_messages will be auto-added';
  END;
END $$;
