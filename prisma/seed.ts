/**
 * Seed script — migrates data.js (MongoDB) to Supabase PostgreSQL
 * Uses postgres.js for raw SQL queries.
 * 
 * Creates:
 *  2 users (admin + customer)
 *  1 seller   (linked to admin)
 *  15 products (linked to admin's seller)
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const sql = postgres(process.env.DIRECT_URL!, {
  max: 1,
});

const ADMIN_PASSWORD = bcrypt.hashSync("123456", 8);
const CUSTOMER_PASSWORD = bcrypt.hashSync("4321", 8);

const DATA = {
  users: [
    { name: "Amir", email: "amiradmin@example.com", password: ADMIN_PASSWORD, isAdmin: true, isSeller: true },
    { name: "Tems", email: "customer@example.com", password: CUSTOMER_PASSWORD, isAdmin: false, isSeller: false },
  ],
  products: [
    { name: "Asus ZenBook Pro Duo", category: "Electronics", image: "/uploads/p1.jpg", brand: "Asus", description: "Asus ZenBook Pro Duo UX581 15.6inch 4K UHD NanoEdge Bezel Touch, Intel Core i9-9980HK, 32GB RAM, 1TB PCIe SSD, GeForce RTX 2060", price: 899.49, countInStock: 15 },
    { name: "ASUS UX534FTC", category: "Electronics", image: "/uploads/p2.jpg", brand: "Asus", description: "ASUS UX534FTC-AS77 ZenBook 15 Laptop, 15.6\" UHD 4K NanoEdge Display, Intel Core i7-10510U, GeForce GTX 1650, 16GB, 512GB PCIe SSD, ScreenPad 2.0, Amazon Alexa Compatible, Windows 10, Icicle Silver", price: 1299.09, countInStock: 13 },
    { name: "ASUS ROG Strix Scar 15 (2020)", category: "Electronics", image: "/uploads/p3.jpg", brand: "Asus", description: "ASUS ROG Strix Scar 15 (2020) Gaming Laptop, 15.6\" 240Hz IPS Type FHD, NVIDIA GeForce RTX 2070 Super, Intel Core i7-10875H, 16GB DDR4, 1TB PCIe NVMe SSD, Per-Key RGB KB, Windows 10, G532LWS-DS76", price: 799.59, countInStock: 23 },
    { name: "Acer Predator Helios", category: "Electronics", image: "/uploads/p4.jpg", brand: "Acer", description: "Acer Predator Helios 300 Gaming Laptop, Intel i7-10750H, NVIDIA GeForce RTX 2060 6GB", price: 1325.29, countInStock: 24 },
    { name: "HP Pavilion Gaming", category: "Electronics", image: "/uploads/p5.jpg", brand: "HP", description: "HP Pavilion Gaming 15-Inch Micro-EDGE Laptop, Intel Core i5-9300H Processor, NVIDIA GeForce GTX 1650 4GB", price: 799.25, countInStock: 51 },
    { name: "ASUS TUF Gaming 27inch 2K HDR Gaming Monitor", category: "Electronics", image: "/uploads/p6.jpg", brand: "Asus", description: "ASUS TUF Gaming 27inch 2K HDR Gaming Monitor (VG27AQ) - WQHD (2560 x 1440), 165Hz (Supports 144Hz), 1ms, Extreme Low Motion Blur", price: 659.46, countInStock: 0 },
    { name: "Acer Nitro 5", category: "Electronics", image: "/uploads/p7.jpg", brand: "Acer", description: "Acer Nitro 5 Gaming Laptop, 9th Gen Intel Core i5-9300H, NVIDIA GeForce GTX 1650, 15.6\"", price: 875.05, countInStock: 0 },
    { name: "GE Forcce RTX 2080", category: "Gaming", image: "/uploads/p8.jpg", brand: "Nvidia", description: "GeForce RTX graphics cards are powered by the Turing GPU architecture and the all-new RTX platform. This gives you up to 6X the performance of previous-generation graphics cards and brings the power of real-time ray tracing and AI to games", price: 1249.05, countInStock: 0 },
    { name: "Razer FHD 144hz", category: "Gaming", image: "/uploads/p9.jpg", brand: "Nvidia", description: "Just when you thought a gaming laptop couldn't be any more beastly—introducing the new Razer Blade 15, now available with the latest 12th Gen Intel Core processor (14-core) and NVIDIA GeForce RTX 30 Series Laptop GPUs for the most powerful gaming laptop graphics ever. With your choice of a Full HD 360Hz, QHD 240Hz (G-SYNC), or new UHD 144Hz display, enjoy unrivalled performance packed into the thinnest 15\" RTX gaming laptop chassis ever.", price: 1249.05, countInStock: 0 },
    { name: "Nike Polo Shirt", category: "Shirts", image: "/uploads/p10.jpg", brand: "Nike", description: "Nike White Polo shirt", price: 100, countInStock: 15 },
    { name: "Under Armour Shirt", category: "Electronics", image: "/uploads/p11.jpg", brand: "Under Armour", description: "Under Armour Polo", price: 120, countInStock: 13 },
    { name: "Adidas Stripe Shirt", category: "Shirts", image: "/uploads/p12.jpg", brand: "Adidas", description: "Adidas Stripe Polo shirt", price: 140, countInStock: 23 },
    { name: "Nike Slack pants", category: "Pants", image: "/uploads/p13.jpg", brand: "Nike", description: "Formal Slack Pants", price: 125, countInStock: 24 },
    { name: "Under Armour Formal pants", category: "Pants", image: "/uploads/p14.jpg", brand: "Under Armour", description: "Premium Slack Pants", price: 155, countInStock: 51 },
    { name: "Adidas Premium Pants", category: "Pants", image: "/uploads/p15.jpg", brand: "Under Armour", description: "Adidas Premium Slack Pants", price: 150, countInStock: 0 },
  ],
};

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  AIMS Commerce — Seed Data Migration");
  console.log("═══════════════════════════════════════\n");

  // Step 1: Create users
  console.log("[1/4] Creating users...");
  const admin = (await sql`
    INSERT INTO "users" (id, name, email, password, is_admin, is_seller)
    VALUES (gen_random_uuid(), ${DATA.users[0].name}, ${DATA.users[0].email}, ${DATA.users[0].password}, true, true)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password = EXCLUDED.password, is_admin = EXCLUDED.is_admin, is_seller = EXCLUDED.is_seller
    RETURNING *;
  `)[0];
  console.log(`  Admin: ${admin.name} (${admin.email})`);

  const customer = (await sql`
    INSERT INTO "users" (id, name, email, password, is_admin, is_seller)
    VALUES (gen_random_uuid(), ${DATA.users[1].name}, ${DATA.users[1].email}, ${DATA.users[1].password}, false, false)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password = EXCLUDED.password
    RETURNING *;
  `)[0];
  console.log(`  Customer: ${customer.name} (${customer.email})`);

  // Step 2: Create seller for admin
  console.log("[2/4] Creating/finding seller profile for admin...");
  let seller = (await sql`SELECT * FROM "sellers" WHERE "user_id" = ${admin.id} LIMIT 1;`)[0];
  
  if (!seller) {
    const storeName = `${admin.name}'s Store`;
    seller = (await sql`
      INSERT INTO "sellers" (id, "user_id", name, "store_name", "is_active_store", rating, "num_reviews", "products_ids")
      VALUES (gen_random_uuid(), ${admin.id}, ${admin.name}, ${storeName}, false, 0, 0, ARRAY[]::text[])
      RETURNING *;
    `)[0];
  }
  console.log(`  Seller: ${seller.name} (${seller.id.slice(0, 8)}...)`);

  // Step 3: Link admin to seller
  console.log("[3/4] Linking admin to seller...");
  await sql`UPDATE "users" SET "seller_id" = ${seller.id} WHERE id = ${admin.id}`;
  console.log(`  seller_id linked: ${seller.id.slice(0, 8)}...`);

  // Step 4: Create products
  console.log("[4/4] Seeding products...");
  let insertedCount = 0;
  for (const p of DATA.products) {
    const result = await sql`
      INSERT INTO "products" (id, name, image, brand, category, description, price, "count_in_stock", rating, "num_reviews", "seller_id", "is_active")
      VALUES (gen_random_uuid(), ${p.name}, ${p.image}, ${p.brand}, ${p.category}, ${p.description}, ${p.price}, ${p.countInStock}, 0, 0, ${seller.id}, true)
      ON CONFLICT (name) DO NOTHING RETURNING id`;
    if (result.length > 0) insertedCount++;
  }
  console.log(`  Inserted ${insertedCount} products (skipped duplicates)`);

  // Summary
  const summary = await sql`
    SELECT
      (SELECT COUNT(*) FROM "users") as users,
      (SELECT COUNT(*) FROM "sellers") as sellers,
      (SELECT COUNT(*) FROM "products") as products`;
  
  console.log("\n═══════════════════════════════════════");
  console.log("  Seed Complete");
  console.log(`  Users:     ${summary[0].users}`);
  console.log(`  Sellers:   ${summary[0].sellers}`);
  console.log(`  Products:  ${summary[0].products}`);
  console.log("═══════════════════════════════════════\n");

  await sql.end();
}

main().catch((e) => { console.error("❌ Seed failed:", e.message); process.exit(1); });
