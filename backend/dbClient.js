/**
 * Database client — postgres.js pool for Supabase pooler.
 * Uses dotenv/config to load env vars at module load time.
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL || process.env.DIRECT_URL;

const sql = postgres(url, {
  max: 10,
  onnotice: () => {},
});

export default sql;
