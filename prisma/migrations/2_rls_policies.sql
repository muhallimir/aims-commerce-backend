-- ============================================
-- Row-Level Security (RLS) Policies for AIMS Commerce
-- ============================================
-- Apply AFTER all tables are created.
-- Fine-grune these per your actual security requirements.

-- Enable RLS on all user-facing tables
ALTER TABLE "users"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviews"     ENABLE ROW LEVEL SECURITY;

-- USERS policies
-- Allow everyone to read user profiles (needed for JWT payload resolution)
CREATE POLICY "users_select_all" ON "users"
  FOR SELECT USING (TRUE);

-- Allow users to update their own profile (not email, password, or isAdmin)
CREATE POLICY "users_update_own" ON "users"
  FOR UPDATE USING (auth.uid() = id);

-- PRODUCTS policies
-- Everyone can read active products
CREATE POLICY "products_select_all" ON "products"
  FOR SELECT USING (TRUE);

-- Admin / Authenticated users can insert, update, delete products
CREATE POLICY "products_insert_admin" ON "products"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "users" u WHERE u.id = auth.uid() AND u.is_admin = TRUE
    )
  );

CREATE POLICY "products_update_admin" ON "products"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "users" u WHERE u.id = auth.uid() AND (u.is_admin = TRUE OR EXISTS (SELECT 1 FROM "sellers" s WHERE s.id = products.seller_id AND s.user_id = auth.uid()))
    )
  );

CREATE POLICY "products_delete_admin" ON "products"
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM "users" u WHERE u.id = auth.uid() AND u.is_admin = TRUE
    )
  );

-- ORDERS policies
-- Users can create their own orders
CREATE POLICY "orders_insert_own" ON "orders"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can read their own orders
CREATE POLICY "orders_select_own" ON "orders"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "users" u WHERE u.id = auth.uid() AND
        (u.is_admin = TRUE OR u.id = orders.user_id)
    )
  );

-- Users can update own orders (payment, delivery)
CREATE POLICY "orders_update_own" ON "orders"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "users" u WHERE u.id = auth.uid() AND
        (u.is_admin = TRUE OR u.id = orders.user_id)
    )
  );

-- SELLERS policies
-- Sellers can read their own seller data
CREATE POLICY "sellers_select_own" ON "sellers"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "users" u WHERE u.id = auth.uid() AND
        (u.is_admin = TRUE OR u.id = sellers.user_id)
    )
  );

-- SELLER PRODUCTS policies
-- Sellers can manage their own products
CREATE POLICY "seller_products_insert_own" ON "products"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "users" u JOIN "sellers" s ON s.user_id = u.id
      WHERE u.id = auth.uid() AND s.id = products.seller_id
    )
  );

CREATE POLICY "seller_products_update_own" ON "products"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "users" u JOIN "sellers" s ON s.user_id = u.id
      WHERE u.id = auth.uid() AND s.id = products.seller_id
    )
  );

CREATE POLICY "seller_products_delete_own" ON "products"
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM "users" u JOIN "sellers" s ON s.user_id = u.id
      WHERE u.id = auth.uid() AND s.id = (SELECT p.seller_id FROM "products" p WHERE p.id = products.id)
    )
  );

-- ORDER ITEMS policies
-- Users can read order items for their own orders
CREATE POLICY "order_items_select_own" ON "order_items"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "orders" o
      WHERE o.id = order_items.order_id AND o.user_id = auth.uid()
    )
  );

-- REVIEWS policies
-- Everyone can read reviews
CREATE POLICY "reviews_select_all" ON "reviews"
  FOR SELECT USING (TRUE);

-- Authenticated users can insert reviews
CREATE POLICY "reviews_insert_owned" ON "reviews"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Owners can update/delete their own reviews
CREATE POLICY "reviews_update_owned" ON "reviews"
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "reviews_delete_owned" ON "reviews"
  FOR DELETE USING (auth.uid() = user_id);
