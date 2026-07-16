/**
 * Apply the chat migration to Supabase.
 * Run: node scripts/applyChatMigration.mjs
 */

import postgres from "postgres";
import fs from "fs/promises";
import "dotenv/config";

const sql = postgres(process.env.DIRECT_URL, { max: 1, onnotice: () => {} });

async function main() {
  console.log("Applying chat migration (5_chat_supabase_realtime.sql)...");
  const sql_text = await fs.readFile(
    "./prisma/migrations/5_chat_supabase_realtime.sql",
    "utf8"
  );

  // Run the whole file in one go. postgres.js sends the multi-statement string
  // to the server, which executes each statement. This avoids the brittleness
  // of splitting on `;` (which appears inside function bodies and DO blocks).
  try {
    await sql.unsafe(sql_text);
  } catch (e) {
    console.error("Migration failed:", e.message);
    throw e;
  }

  // Verify
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('chat_sessions', 'chat_messages')
    ORDER BY table_name
  `;
  console.log(`\n✓ Tables created: ${tables.map((t) => t.table_name).join(", ")}`);

  const rls = await sql`
    SELECT tablename, rowsecurity FROM pg_tables
    WHERE schemaname = 'public' AND tablename IN ('chat_sessions', 'chat_messages')
  `;
  console.log("RLS status:");
  rls.forEach((r) => console.log(`  ${r.tablename}: rls=${r.rowsecurity}`));

  const pub = await sql`
    SELECT schemaname, tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename IN ('chat_sessions', 'chat_messages')
  `;
  console.log("Realtime publication:");
  if (pub.length === 0) {
    console.log("  (not yet added — Supabase will auto-discover on first connection)");
  } else {
    pub.forEach((p) => console.log(`  ${p.schemaname}.${p.tablename}`));
  }
}

try {
  await main();
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
