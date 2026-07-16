-- Seed Verification Queries
-- Run these after: npx tsx prisma/seed.ts
-- to verify all data was seeded correctly.

-- Check record counts
SELECT 'Users' as entity, COUNT(*) as count FROM "users"
UNION ALL
SELECT 'Sellers', COUNT(*) FROM "sellers"
UNION ALL
SELECT 'Products', COUNT(*) FROM "products"
UNION ALL
SELECT 'Reviews', COUNT(*) FROM "reviews"
UNION ALL
SELECT 'Orders', COUNT(*) FROM "orders";

-- Verify admin user
SELECT id, name, email, is_admin as "isAdmin", is_seller as "isSeller"
FROM "users" WHERE email = 'amiradmin@example.com';

-- Verify customer user
SELECT id, name, email, is_admin as "isAdmin", is_seller as "isSeller"
FROM "users" WHERE email = 'customer@example.com';

-- Verify seller is linked to admin
SELECT s.id, s.name, s.store_name, s.is_active_store, u.email
FROM "sellers" s
JOIN "users" u ON u.id = s.user_id
WHERE u.is_admin = true;

-- Verify products count and seller linkage
SELECT p.name, p.category, p.price, p.count_in_stock, p.seller_id || '' as "seller_id"
FROM "products" p
ORDER BY p.name;

-- Verify all products are linked to admin's seller
SELECT p.name, u.email as "admin_email"
FROM "products" p
JOIN "sellers" s ON s.id = p.seller_id
JOIN "users" u ON u.id = s.user_id
WHERE u.is_admin = true;
