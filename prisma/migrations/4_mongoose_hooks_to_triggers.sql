-- ============================================
-- Mongoose Hook Equivalents (PostgreSQL Triggers)
-- ============================================
-- Converts MongoDB Mongoose hooks to PostgreSQL triggers

-- =====================================================
-- HOOK 1: productSchema.pre("save") — recalculate rating
-- Mongoose: On save, averages review ratings and updates product
-- PostgreSQL: Trigger AFTER INSERT/UPDATE/DELETE on reviews
-- =====================================================
CREATE OR REPLACE FUNCTION recalculate_product_rating()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id UUID;
  v_avg_rating DECIMAL(3,2);
  v_review_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.rating = NEW.rating AND OLD.comment = NEW.comment THEN
      RETURN NEW;
    END IF;
    v_product_id := NEW.product_id;
  ELSIF TG_OP = 'INSERT' THEN
    v_product_id := NEW.product_id;
  END IF;

  SELECT COALESCE(AVG(rating), 0)::DECIMAL(3,2), COUNT(*)
  INTO v_avg_rating, v_review_count
  FROM "reviews" WHERE "product_id" = v_product_id;

  -- Only update if actually changed (avoid infinite trigger loops)
  UPDATE "products"
  SET "rating" = v_avg_rating,
      "num_reviews" = v_review_count
  WHERE "id" = v_product_id
    AND ("rating" IS DISTINCT FROM v_avg_rating
      OR "num_reviews" IS DISTINCT FROM v_review_count);

  RETURN (CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trigger_recalculate_product_rating"
  AFTER INSERT OR UPDATE OR DELETE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION recalculate_product_rating();

-- =====================================================
-- HOOK 2: userSchema.post("save") — create seller when isSeller=true
-- Mongoose: When user.isSeller becomes true, auto-create seller doc
-- PostgreSQL: Trigger AFTER UPDATE on users
-- =====================================================
CREATE OR REPLACE FUNCTION auto_create_seller_on_isSeller()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."is_seller" = TRUE AND OLD."is_seller" = FALSE AND OLD."id" IS NOT NULL THEN
    INSERT INTO "sellers" ("user_id", "name", "is_active_store", "store_name")
    VALUES (NEW."id", NEW."name", FALSE, NEW."store_name");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trigger_auto_create_seller"
  AFTER UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION auto_create_seller_on_isSeller();

-- =====================================================
-- HOOK 3: sellerModel — sync seller.name/storeName when user changes
-- Mongoose: userSchema pre save hook updates matching seller doc
-- PostgreSQL: Trigger AFTER UPDATE on users
-- =====================================================
CREATE OR REPLACE FUNCTION sync_seller_on_user_name_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD."name" IS DISTINCT FROM NEW."name") OR
     (COALESCE(OLD."store_name", '') IS DISTINCT FROM COALESCE(NEW."store_name", '')) THEN
    UPDATE "sellers"
    SET "name" = NEW."name",
        "store_name" = COALESCE(NEW."store_name", "sellers"."store_name"),
        "updated_at" = NOW()
    WHERE "user_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trigger_sync_seller_name"
  AFTER UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION sync_seller_on_user_name_change();

-- =====================================================
-- HOOK 4: userSchema.pre("save") — auto-synchronize updated_at
-- MongoDB: Mongoose handles updatedAt automatically
-- PostgreSQL: Manual trigger for updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updated_at" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to all tables
CREATE TRIGGER "update_users_updated_at"
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "update_sellers_updated_at"
  BEFORE UPDATE ON "sellers"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "update_products_updated_at"
  BEFORE UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "update_orders_updated_at"
  BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "update_reviews_updated_at"
  BEFORE UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- HOOK 5: orderModel — deliveredAt auto-set when isDelivered=true
-- Mongoose: orderSchema pre save hook sets deliveredAt
-- PostgreSQL: No trigger needed; handled in app logic
-- =====================================================
