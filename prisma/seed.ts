/**
 * Seed script — single source of truth is the MongoDB dump in mongo-dump/.
 * This script just shells out to scripts/migrateMongoToSupabase.mjs.
 *
 * For backwards compatibility, `npm run db:seed` (which calls this file)
 * still works.
 */

import { spawnSync } from "child_process";

console.log("════════════════════════════════════════════");
console.log("  AIMS Commerce — Seed");
console.log("  Source: mongo-dump/ → Supabase (1:1 parity)");
console.log("════════════════════════════════════════════\n");

const result = spawnSync("node", ["scripts/migrateMongoToSupabase.mjs", "--truncate"], {
  stdio: "inherit",
  cwd: process.cwd(),
});

process.exit(result.status ?? 1);
