#!/usr/bin/env node
/**
 * Scans every text column in the Supabase database for any row containing
 * the __TEST__ prefix (or any of the other test markers used by the e2e
 * and chat test suites). Reports counts and exits non-zero if anything
 * is found.
 *
 * Usage:  node scripts/scan_test_data.mjs
 *         # or with explicit URL:
 *         DIRECT_URL=postgres://... node scripts/scan_test_data.mjs
 */

import postgres from "postgres";

const URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!URL) {
  console.error("Set DIRECT_URL or DATABASE_URL before running this script.");
  process.exit(2);
}

const MARKERS = ["__TEST__", "@aims.test", "@example.test"];

const TABLES = [
  { name: "users",          cols: ["name", "email", "phone", "address", "city", "country", "store_name"] },
  { name: "sellers",        cols: ["name", "store_name", "store_description", "profile_image"] },
  { name: "products",       cols: ["name", "description", "brand", "category"] },
  { name: "orders",         cols: ["shipping_full_name", "shipping_address", "shipping_city", "payment_result"] },
  { name: "order_items",    cols: ["name"] },
  { name: "reviews",        cols: ["comment", "name"] },
  { name: "chat_sessions",  cols: ["user_name", "seller_name"] },
  { name: "chat_messages",  cols: ["sender_name", "message", "body"] },
];

const sql = postgres(URL, { max: 1, ssl: "require" });
let totalFound = 0;

console.log("\n═══ Scanning Supabase for test data ═══");
console.log(`Markers: ${MARKERS.join(", ")}`);

for (const t of TABLES) {
  for (const marker of MARKERS) {
    let count = 0;
    for (const col of t.cols) {
      try {
        const r = await sql.unsafe(
          `SELECT COUNT(*)::int AS n FROM ${t.name} WHERE ${col} LIKE '%${marker}%'`
        );
        count += r[0].n;
      } catch (_) { /* column doesn't exist, skip */ }
    }
    if (count > 0) {
      console.log(`  ✗ ${t.name.padEnd(20)} ${count} row(s) matching "${marker}"`);
      // Show the offending rows
      for (const col of t.cols) {
        try {
          const rows = await sql.unsafe(
            `SELECT id, ${col} AS val FROM ${t.name} WHERE ${col} LIKE '%${marker}%' LIMIT 5`
          );
          rows.forEach((r) => console.log(`      ${r.id}  ${col}="${r.val}"`));
        } catch (_) { /* skip */ }
      }
      totalFound += count;
    }
  }
}

await sql.end();

console.log("");
if (totalFound === 0) {
  console.log("  ✓ CLEAN — no test data found in any table.");
  process.exit(0);
} else {
  console.log(`  ✗ DIRTY — ${totalFound} test row(s) remain.`);
  console.log("    Run `node scripts/e2e_test.mjs` (which has its own cleanup),");
  console.log("    or wipe manually with:");
  console.log(`      DELETE FROM order_items  WHERE name LIKE '%__TEST__%';`);
  console.log(`      DELETE FROM orders       WHERE shipping_full_name LIKE '%__TEST__%';`);
  console.log(`      DELETE FROM products     WHERE name LIKE '%__TEST__%';`);
  console.log(`      DELETE FROM sellers      WHERE name LIKE '%__TEST__%';`);
  console.log(`      DELETE FROM users        WHERE email LIKE '%__TEST__%' OR name LIKE '%__TEST__%';`);
  console.log(`      DELETE FROM reviews      WHERE comment LIKE '%__TEST__%';`);
  console.log(`      DELETE FROM chat_messages WHERE sender_name LIKE '%__TEST__%' OR body LIKE '%__TEST__%';`);
  console.log(`      DELETE FROM chat_sessions  WHERE user_name LIKE '%__TEST__%';`);
  process.exit(1);
}
