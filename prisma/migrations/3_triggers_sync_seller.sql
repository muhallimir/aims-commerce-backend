-- ============================================
-- Auto-synchronize seller when user name/store changes
-- ============================================
-- Part of: MongoDB trigger → PostgreSQL trigger conversion

CREATE OR REPLACE FUNCTION sync_seller_on_user_update()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.name IS DISTINCT FROM NEW.name) OR
     (OLD.store_name IS DISTINCT FROM NEW.store_name) THEN
    UPDATE "sellers"
    SET "name" = NEW.name,
        "store_name" = COALESCE(NEW."store_name", "sellers"."store_name"),
        "updated_at" = NOW()
    WHERE "user_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trigger_sync_seller_on_user_update"
  AFTER UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION sync_seller_on_user_update();
