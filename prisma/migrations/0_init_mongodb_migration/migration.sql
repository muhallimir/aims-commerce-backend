-- Prisma Schema Migration — MongoDB → Supabase PostgreSQL
-- Generated: Phase 3 of MongoDB to Supabase Migration

-- ============================================
-- 1. PostgreSQL Extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- 2. Tables (maps to MongoDB collections)
-- ============================================

-- TABLE: users (was: users collection)
CREATE TABLE "users" (
  "id"           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"         VARCHAR(255) NOT NULL,
  "email"        VARCHAR(255) NOT NULL UNIQUE,
  "password"     VARCHAR(255) NOT NULL,
  "phone"        VARCHAR(50),
  "address"      TEXT,
  "city"         VARCHAR(100),
  "country"      VARCHAR(100),
  "is_admin"     BOOLEAN      DEFAULT FALSE NOT NULL,
  "is_seller"    BOOLEAN      DEFAULT FALSE NOT NULL,
  "store_name"   VARCHAR(255),
  "seller_id"    UUID,
  "created_at"   TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
  "updated_at"   TIMESTAMPTZ  DEFAULT NOW() NOT NULL
);

-- TABLE: sellers (was: sellers collection)
CREATE TABLE "sellers" (
  "id"                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"            UUID         NOT NULL UNIQUE,
  "name"               VARCHAR(255) NOT NULL,
  "store_name"         VARCHAR(255),
  "store_description"  TEXT,
  "profile_image"      VARCHAR(500),
  "is_active_store"    BOOLEAN      DEFAULT FALSE NOT NULL,
  "rating"             DECIMAL(3,2) DEFAULT 0.00 NOT NULL,
  "num_reviews"        INTEGER      DEFAULT 0 NOT NULL,
  "products_ids"       TEXT[],
  "created_at"         TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
  "updated_at"         TIMESTAMPTZ  DEFAULT NOW() NOT NULL
);

-- TABLE: products (was: products collection)
CREATE TABLE "products" (
  "id"             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"           VARCHAR(255) NOT NULL UNIQUE,
  "image"          VARCHAR(500) NOT NULL,
  "brand"          VARCHAR(100) NOT NULL,
  "category"       VARCHAR(100) NOT NULL,
  "description"    TEXT,
  "price"          DECIMAL(10,2) NOT NULL,
  "count_in_stock" INTEGER      NOT NULL,
  "rating"         DECIMAL(3,2) DEFAULT 0.00 NOT NULL,
  "num_reviews"    INTEGER      DEFAULT 0 NOT NULL,
  "is_active"      BOOLEAN      DEFAULT TRUE NOT NULL,
  "seller_id"      UUID         NOT NULL,
  "created_at"     TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
  "updated_at"     TIMESTAMPTZ  DEFAULT NOW() NOT NULL
);

-- TABLE: orders (was: orders collection)
CREATE TABLE "orders" (
  "id"               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"          UUID         NOT NULL,
  "payment_method"   VARCHAR(50)  NOT NULL,
  "payment_result"   JSONB,
  "items_price"      DECIMAL(12,2) NOT NULL,
  "shipping_price"   DECIMAL(12,2) NOT NULL,
  "tax_price"        DECIMAL(12,2) NOT NULL,
  "total_price"      DECIMAL(12,2) NOT NULL,
  "shipping_full_name"  VARCHAR(255),
  "shipping_contact"    VARCHAR(50),
  "shipping_address"    TEXT,
  "shipping_city"       VARCHAR(100),
  "shipping_postal_code" VARCHAR(20),
  "shipping_country"    VARCHAR(100),
  "shipping_lat"       DECIMAL(10,8),
  "shipping_lng"       DECIMAL(11,8),
  "is_paid"            BOOLEAN      DEFAULT FALSE NOT NULL,
  "paid_at"            TIMESTAMPTZ,
  "is_delivered"       BOOLEAN      DEFAULT FALSE NOT NULL,
  "delivered_at"       TIMESTAMPTZ,
  "created_at"         TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
  "updated_at"         TIMESTAMPTZ  DEFAULT NOW() NOT NULL
);

-- TABLE: order_items (extracted from embedded orderItems in orders)
CREATE TABLE "order_items" (
  "id"         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id"   UUID         NOT NULL,
  "product_id" UUID         NOT NULL,
  "seller_id"  UUID,
  "name"       VARCHAR(255) NOT NULL,
  "qty"        INTEGER      NOT NULL,
  "image"      VARCHAR(500) NOT NULL,
  "price"      DECIMAL(10,2) NOT NULL
);

-- TABLE: reviews (extracted from embedded reviews in products)
CREATE TABLE "reviews" (
  "id"         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" UUID         NOT NULL,
  "user_id"    UUID         NOT NULL,
  "name"       VARCHAR(255) NOT NULL,
  "comment"    TEXT,
  "rating"     DECIMAL(3,2) NOT NULL,
  "created_at" TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMPTZ  DEFAULT NOW() NOT NULL
);

-- ============================================
-- 3. Foreign Key Constraints
-- ============================================

-- sellers → users (cascade delete: when user deleted, seller deleted)
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- products → sellers (cascade delete: when seller deleted, products deleted)
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE;

-- orders → users
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id");

-- order_items → orders (cascade delete)
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;

-- order_items → products
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id");

-- order_items → sellers (nullable)
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id");

-- reviews → products (cascade delete)
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;

-- reviews → users
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id");

-- ============================================
-- 4. Indexes
-- ============================================

-- products indexes
CREATE INDEX "idx_products_category"       ON "products" ("category");
CREATE INDEX "idx_products_price"          ON "products" ("price");
CREATE INDEX "idx_products_rating"         ON "products" ("rating");
CREATE INDEX "idx_products_seller_id"      ON "products" ("seller_id");
CREATE INDEX "idx_products_is_active"      ON "products" ("is_active") WHERE "is_active" = true;

-- orders indexes
CREATE INDEX "idx_orders_user_id"          ON "orders" ("user_id");
CREATE INDEX "idx_orders_is_paid"          ON "orders" ("is_paid") WHERE "is_paid" = true;
CREATE INDEX "idx_orders_is_delivered"     ON "orders" ("is_delivered") WHERE "is_delivered" = true;
CREATE INDEX "idx_orders_created_at"       ON "orders" ("created_at");

-- order_items indexes
CREATE INDEX "idx_order_items_order_id"    ON "order_items" ("order_id");
CREATE INDEX "idx_order_items_seller_id"   ON "order_items" ("seller_id");

-- reviews indexes
CREATE UNIQUE INDEX "idx_reviews_product_user" ON "reviews" ("product_id", "user_id");
CREATE INDEX "idx_reviews_product_id"       ON "reviews" ("product_id");

-- ============================================
-- 5. Triggers for Updated_at Auto-Update
-- ============================================

-- Trigger function for automatic updated_at on any table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to all tables
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

-- ============================================
-- 6. Mongoose Hook Equivalents (PostgreSQL Triggers)
-- ============================================

-- Trigger: Auto-synchronize product rating & num_reviews when reviews are added/updated/ deleted
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
    -- Only recalculate if rating or comment changed
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

  UPDATE "products"
  SET "rating" = v_avg_rating,
      "num_reviews" = v_review_count,
      "updated_at" = NOW()
  WHERE "id" = v_product_id;

  RETURN (CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trigger_recalculate_product_rating"
  AFTER INSERT OR UPDATE OR DELETE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION recalculate_product_rating();

-- Trigger: Sync seller name / storeName when user changes
CREATE OR REPLACE FUNCTION sync_seller_on_user_update()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.name IS DISTINCT FROM NEW.name) OR
     (OLD.store_name IS DISTINCT FROM NEW.store_name) THEN
    UPDATE "sellers"
    SET "name" = NEW.name,
        "store_name" = COALESCE(NEW.store_name, "sellers"."store_name"),
        "updated_at" = NOW()
    WHERE "user_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trigger_sync_seller_on_user_update"
  AFTER UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION sync_seller_on_user_update();

-- Trigger: Auto-create seller when user becomes seller
CREATE OR REPLACE FUNCTION auto_create_seller()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."is_seller" = TRUE AND OLD."is_seller" = FALSE THEN
    INSERT INTO "sellers" ("user_id", "name", "is_active_store", "store_name")
    VALUES (NEW."id", NEW."name", FALSE, NEW."store_name");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trigger_auto_create_seller"
  AFTER UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION auto_create_seller();

-- Trigger: Auto-verify product name uniqueness constraint error handling
-- (handled automatically by the UNIQUE constraint on products.name)

-- ============================================
-- 7. Row-Level Security (RLS) — enable on user-facing tables
-- ============================================

-- Enable RLS on all user-facing tables
ALTER TABLE "users"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviews"     ENABLE ROW LEVEL SECURITY;

-- RLS policy: Allow authenticated users to read their own data (profiles)
CREATE POLICY "users_select_own" ON "users"
  FOR SELECT USING (auth.uid() = id OR auth.uid() IS NULL);

-- RLS policy: Allow authenticated users to update their own profile
CREATE POLICY "users_update_own" ON "users"
  FOR UPDATE USING (auth.uid() = id OR auth.uid() IS NULL);

-- RLS policy: Allow everyone to read active products
CREATE POLICY "products_select_all" ON "products"
  FOR SELECT USING (TRUE);

-- RLS policy: Allow authenticated users to create orders
CREATE POLICY "orders_insert_own" ON "orders"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS policy: Allow users to read their own orders
CREATE POLICY "orders_select_own" ON "orders"
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() IS NULL);

-- RLS policy: Allow users to update their own order payment status
CREATE POLICY "orders_update_own" ON "orders"
  FOR UPDATE USING (auth.uid() = user_id OR auth.uid() IS NULL);

-- RLS policy: Allow users to read their own order items
CREATE POLICY "order_items_select_own" ON "order_items"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "orders" o WHERE o.id = order_items.order_id AND o.user_id = auth.uid()
    )
  );

-- RLS policy: Allow users to create reviews for products
CREATE POLICY "reviews_insert_own" ON "reviews"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS policy: Allow users to read reviews
CREATE POLICY "reviews_select_all" ON "reviews"
  FOR SELECT USING (TRUE);

-- ============================================
-- 8. Grant Privileges
-- ============================================

-- Allow service role and anon role to access all tables (fine-tune per your RLS policy design)
GRANT USAGE ON SCHEMA public TO postgres, service_role, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role, anon, authenticated;
