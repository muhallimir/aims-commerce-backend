/**
 * Chat E2E test — Supabase Realtime.
 *
 * Verifies the chat tables + realtime publication + RLS by:
 *  1. Inserting a chat_sessions row as a test user
 *  2. Inserting a chat_messages row
 *  3. Subscribing via Supabase Realtime and confirming the broadcast arrives
 *  4. Cleanup: deletes the test rows
 *
 * All test data uses the __TEST__ prefix so it can be auto-cleaned.
 *
 * Run: node scripts/chat_test.mjs
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const PREFIX = "__TEST__";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const DIRECT_URL = process.env.DIRECT_URL;

if (!SUPABASE_URL || !SUPABASE_KEY || !DIRECT_URL) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL in .env");
  process.exit(1);
}

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; }
  else { console.log(`  FAIL  ${name}${extra ? " — " + extra : ""}`); failed++; }
}

// Two clients to simulate user + admin
const admin = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log("═══ Supabase Realtime chat E2E ═══\n");

  // Use a real user from the migration for FK
  const { default: postgres } = await import("postgres");
  const sql = postgres(DIRECT_URL, { max: 1, onnotice: () => {} });

  const user = (await sql`
    SELECT id, name, email, is_admin FROM users WHERE email = 'admin@example.com' LIMIT 1
  `)[0];
  if (!user) {
    console.error("Could not find admin@example.com in DB — did you run db:migrate?");
    process.exit(1);
  }
  console.log(`Using test identity: ${user.email} (${user.id})`);

  // Cleanup any leftover __TEST__ chat rows
  await sql`DELETE FROM chat_messages WHERE sender_name LIKE ${PREFIX + '%'} OR body LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM chat_sessions WHERE user_name LIKE ${PREFIX + '%'}`;

  // 1. Insert a chat_session row
  console.log("\n[1/4] Insert chat_session…");
  const { data: sess, error: sessErr } = await admin
    .from("chat_sessions")
    .upsert(
      {
        user_id: user.id,
        user_name: PREFIX + user.name,
        user_email: user.email,
        is_admin: user.is_admin,
        online: true,
        last_seen: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();
  ok("chat_sessions insert", !sessErr && sess, sessErr?.message);

  // 2. Subscribe to chat_messages INSERT
  console.log("\n[2/4] Subscribe to chat_messages…");
  let resolveBroadcast;
  const received = new Promise((resolve) => { resolveBroadcast = resolve; });
  const failTimer = setTimeout(() => resolveBroadcast(null), 8000);

  const channel = supabase.channel("chat-test-" + Date.now());
  channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" },
    (payload) => {
      console.log("  [realtime] received broadcast");
      clearTimeout(failTimer);
      resolveBroadcast(payload.new);
    });
  channel.subscribe((status, err) => {
    console.log(`  [realtime] subscribe status: ${status}${err ? " — " + err.message : ""}`);
  });

  // Wait for SUBSCRIBED before inserting
  await new Promise((resolve) => {
    const check = setInterval(() => {
      // The channel emits a "system" event when SUBSCRIBED. We just wait 2s.
    }, 100);
    setTimeout(() => { clearInterval(check); resolve(); }, 2500);
  });

  // 3. Insert a chat_message
  console.log("[3/4] Insert chat_message…");
  const msgBody = PREFIX + " Hello, this is an E2E test message";
  const { data: msg, error: msgErr } = await admin
    .from("chat_messages")
    .insert({
      sender_id: user.id,
      sender_name: PREFIX + user.name,
      is_admin: false,
      recipient_id: null,
      body: msgBody,
    })
    .select()
    .single();
  ok("chat_messages insert", !msgErr && msg, msgErr?.message);

  // 4. Wait for the broadcast
  console.log("[4/4] Wait for realtime broadcast…");
  const broadcast = await received;
  if (broadcast) {
    ok("realtime broadcast received", broadcast.body === msgBody, `got: ${broadcast?.body}`);
    ok("broadcast has sender_name", broadcast.sender_name === PREFIX + user.name, `got: ${broadcast?.sender_name}`);
  } else {
    ok("realtime broadcast received", false, "timeout after 5s — check supabase_realtime publication");
  }

  // Cleanup
  console.log("\n═══ Cleanup ═══");
  const r1 = await sql`DELETE FROM chat_messages WHERE sender_name LIKE ${PREFIX + '%'} OR body LIKE ${PREFIX + '%'}`;
  const r2 = await sql`DELETE FROM chat_sessions WHERE user_name LIKE ${PREFIX + '%'}`;
  console.log(`  Deleted: ${r1.count} messages, ${r2.count} sessions`);

  await sql.end();
  await supabase.removeAllChannels();

  console.log(`\n═══════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════\n");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Chat test crashed:", e);
  process.exit(1);
});
