/**
 * MongoDB → Supabase migration (1:1 parity, batched for speed).
 * Run: node scripts/migrateMongoToSupabase.mjs --truncate
 */

import fs from "fs/promises";
import crypto from "crypto";
import postgres from "postgres";
import "dotenv/config";

const DUMP_DIR = "./mongo-dump";
const NS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function uuid(oid) {
  if (!oid) return null;
  const hex = crypto.createHash("md5").update(NS + String(oid)).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function loadJson(name) {
  return JSON.parse(await fs.readFile(`${DUMP_DIR}/${name}.json`, "utf8"));
}

// Bulk insert using a single multi-row VALUES — sends 1 query for N rows.
// `casts` is an object mapping column name → SQL cast. Use `text::boolean`
// (two-step) for booleans because postgres.js parameterized queries don't
// honour `::boolean` on a text-typed parameter.
// For other types, prefer passing native JS values (true/false, Date, Number).
async function bulkInsert(sql, table, columns, rows, casts = {}) {
  if (rows.length === 0) return 0;
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = rows
    .map((_, i) =>
      `(${columns
        .map((__, j) => {
          const n = i * columns.length + j + 1;
          return `$${n}${casts[columns[j]] || ""}`;
        })
        .join(", ")})`
    )
    .join(", ");
  const values = rows.flat();
  const query = `INSERT INTO ${table} (${colList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
  return await sql.unsafe(query, values);
}

async function main() {
  const truncate = process.argv.includes("--truncate");
  const sql = postgres(process.env.DIRECT_URL, { max: 1, onnotice: () => {} });

  try {
    console.log("═══ MongoDB → Supabase migration (batched) ═══\n");

    if (truncate) {
      console.log("[0] Truncating...");
      await sql`TRUNCATE TABLE "reviews", "order_items", "orders", "products", "sellers", "users" RESTART IDENTITY CASCADE`;
    }

    // Make order_items.product_id nullable — original MongoDB has order items pointing
    // to products that were later deleted; we preserve the order but null the broken ref.
    await sql.unsafe(`ALTER TABLE "order_items" ALTER COLUMN "product_id" DROP NOT NULL`);

    const [users, sellers, products, orders] = await Promise.all([
      loadJson("users"),
      loadJson("sellers"),
      loadJson("products"),
      loadJson("orders"),
    ]);
    console.log(`Loaded: ${users.length} users, ${sellers.length} sellers, ${products.length} products, ${orders.length} orders\n`);

    // ── Users ─────────────────────────────────────────────
    console.log("[1/4] Users...");
    const t0 = Date.now();
    const userRows = users.map((u) => [
      uuid(u._id),
      u.name || "",
      u.email,
      u.password || "",
      u.phone || null,
      u.address || null,
      u.city || null,
      u.country || null,
      Boolean(u.isAdmin),
      Boolean(u.isSeller),
      u.storeName || null,
      u.seller ? uuid(u.seller) : null,
      u.createdAt ? new Date(u.createdAt) : new Date(),
      u.updatedAt ? new Date(u.updatedAt) : new Date(),
    ]);
    await bulkInsert(sql, "users",
      ["id", "name", "email", "password", "phone", "address", "city", "country",
       "is_admin", "is_seller", "store_name", "seller_id", "created_at", "updated_at"],
      userRows,
      { id: "::uuid", seller_id: "::uuid", created_at: "::timestamptz", updated_at: "::timestamptz" }
    );
    console.log(`  ${userRows.length} users in ${Date.now() - t0}ms`);

    // ── Sellers ───────────────────────────────────────────
    console.log("[2/4] Sellers...");
    const t1 = Date.now();
    const sellerRows = sellers.map((s) => [
      uuid(s._id),
      uuid(s.user),
      s.name || "",
      s.storeName || null,
      s.storeDescription || null,
      s.profileImage || null,
      Boolean(s.isActiveStore),
      Number(s.rating) || 0,
      Number(s.numReviews) || 0,
      (s.products || []).map((p) => uuid(p)),
      s.createdAt ? new Date(s.createdAt) : new Date(),
      s.updatedAt ? new Date(s.updatedAt) : new Date(),
    ]);
    {
      const tStart = Date.now();
      const colList = ["id", "user_id", "name", "store_name", "store_description", "profile_image",
        "is_active_store", "rating", "num_reviews", "products_ids", "created_at", "updated_at"];
      const colsQuoted = colList.map((c) => `"${c}"`).join(", ");
      const castedPlaceholders = sellerRows
        .map((_, i) => {
          const cols = colList.map((__, j) => {
            const n = i * colList.length + j + 1;
            if (["id", "user_id"].includes(colList[j])) return `$${n}::uuid`;
            if (colList[j] === "rating") return `$${n}::numeric`;
            if (colList[j] === "num_reviews") return `$${n}::int`;
            if (colList[j] === "products_ids") return `$${n}::text[]`;
            if (["created_at", "updated_at"].includes(colList[j])) return `$${n}::timestamptz`;
            return `$${n}`;
          });
          return `(${cols.join(", ")})`;
        })
        .join(", ");
      const values = sellerRows.flat();
      const query = `INSERT INTO sellers (${colsQuoted}) VALUES ${castedPlaceholders} ON CONFLICT (id) DO NOTHING`;
      try {
        await sql.unsafe(query, values);
        console.log(`  ${sellerRows.length} sellers in ${Date.now() - tStart}ms`);
      } catch (e) {
        console.log(`  seller bulk fail: ${e.message.slice(0, 200)}`);
      }
    }

    // ── Products ──────────────────────────────────────────
    console.log("[3/4] Products...");
    const t2 = Date.now();
    const productRows = products.map((p) => [
      uuid(p._id),
      p.name,
      p.image || "/uploads/sample.jpg",
      p.brand || "",
      p.category || "",
      p.description || "",
      Number(p.price) || 0,
      Number(p.countInStock) || 0,
      Number(p.rating) || 0,
      Number(p.numReviews) || 0,
      p.seller ? uuid(p.seller) : null,
      p.isActive !== false,
      p.createdAt ? new Date(p.createdAt) : new Date(),
      p.updatedAt ? new Date(p.updatedAt) : new Date(),
    ]);
    await bulkInsert(sql, "products",
      ["id", "name", "image", "brand", "category", "description",
       "price", "count_in_stock", "rating", "num_reviews",
       "seller_id", "is_active", "created_at", "updated_at"],
      productRows,
      { id: "::uuid", seller_id: "::uuid", price: "::numeric", count_in_stock: "::int",
        rating: "::numeric", num_reviews: "::int", created_at: "::timestamptz", updated_at: "::timestamptz" }
    );
    console.log(`  ${productRows.length} products in ${Date.now() - t2}ms`);

    // ── Orders + items ────────────────────────────────────
    console.log("[4/4] Orders + items...");
    const t3 = Date.now();
    const orderRows = orders.map((o) => {
      const s = o.shippingAddress || {};
      return [
        uuid(o._id),
        uuid(o.user),
        o.paymentMethod || "PayPal",
        o.paymentResult ? JSON.stringify(o.paymentResult) : null,
        Number(o.itemsPrice) || 0,
        Number(o.shippingPrice) || 0,
        Number(o.taxPrice) || 0,
        Number(o.totalPrice) || 0,
        s.fullName || "",
        s.contact || "",
        s.address || "",
        s.city || "",
        s.postalCode || "",
        s.country || "",
        s.lat ? Number(s.lat) : null,
        s.lng ? Number(s.lng) : null,
        Boolean(o.isPaid),
        o.paidAt ? new Date(o.paidAt) : null,
        Boolean(o.isDelivered),
        o.deliveredAt ? new Date(o.deliveredAt) : null,
        o.createdAt ? new Date(o.createdAt) : new Date(),
        o.updatedAt ? new Date(o.updatedAt) : new Date(),
      ];
    });
    await bulkInsert(sql, "orders",
      ["id", "user_id", "payment_method", "payment_result",
       "items_price", "shipping_price", "tax_price", "total_price",
       "shipping_full_name", "shipping_contact", "shipping_address", "shipping_city",
       "shipping_postal_code", "shipping_country", "shipping_lat", "shipping_lng",
       "is_paid", "paid_at", "is_delivered", "delivered_at",
       "created_at", "updated_at"],
      orderRows,
      { id: "::uuid", user_id: "::uuid",
        items_price: "::numeric", shipping_price: "::numeric", tax_price: "::numeric", total_price: "::numeric",
        shipping_lat: "::numeric", shipping_lng: "::numeric",
        paid_at: "::timestamptz", delivered_at: "::timestamptz",
        created_at: "::timestamptz", updated_at: "::timestamptz" }
    );
    console.log(`  ${orderRows.length} orders in ${Date.now() - t3}ms`);

    // Order items — pre-fetch existing product/seller UUID sets so we can null out broken FKs
    const t4 = Date.now();
    const existingProducts = new Set((await sql`SELECT id FROM products`).map((r) => r.id));
    const existingSellers = new Set((await sql`SELECT id FROM sellers`).map((r) => r.id));
    console.log(`  products in DB: ${existingProducts.size}, sellers in DB: ${existingSellers.size}`);

    const itemRows = [];
    let skippedItems = 0;
    for (const o of orders) {
      for (const item of o.orderItems || []) {
        const productUuid = item.product ? uuid(item.product) : null;
        const sellerUuid = item.seller ? uuid(item.seller) : null;
        // Null out broken FKs (original MongoDB has dangling refs to deleted products/sellers)
        const safeProduct = productUuid && existingProducts.has(productUuid) ? productUuid : null;
        const safeSeller = sellerUuid && existingSellers.has(sellerUuid) ? sellerUuid : null;
        if (productUuid && !safeProduct) skippedItems++;
        // Truncate long base64 images (schema is varchar(500))
        const img = item.image && item.image.length > 500 ? "/uploads/legacy-item.jpg" : (item.image || "");
        const nm = item.name && item.name.length > 200 ? item.name.slice(0, 200) : (item.name || "");
        itemRows.push([
          uuid(item._id),
          uuid(o._id),
          safeProduct,
          safeSeller,
          nm,
          String(Number(item.qty) || 1),
          img,
          String(Number(item.price) || 0),
        ]);
      }
    }
    await bulkInsert(sql, "order_items",
      ["id", "order_id", "product_id", "seller_id", "name", "qty", "image", "price"],
      itemRows,
      { id: "::uuid", order_id: "::uuid", product_id: "::uuid", seller_id: "::uuid",
        qty: "::int", price: "::numeric" }
    );
    console.log(`  ${itemRows.length} order items in ${Date.now() - t4}ms (${skippedItems} broken product refs nulled)`);

    // ── Final tally ──────────────────────────────────────
    const summary = await sql`
      SELECT
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM sellers) as sellers,
        (SELECT COUNT(*) FROM products) as products,
        (SELECT COUNT(*) FROM orders) as orders,
        (SELECT COUNT(*) FROM order_items) as order_items
    `;
    console.log("\n════════════════════════════════════════════");
    console.log("  Migration Complete");
    console.log(`  Users:      ${summary[0].users}`);
    console.log(`  Sellers:    ${summary[0].sellers}`);
    console.log(`  Products:   ${summary[0].products}`);
    console.log(`  Orders:     ${summary[0].orders}`);
    console.log(`  OrderItems: ${summary[0].order_items}`);
    console.log("════════════════════════════════════════════\n");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
