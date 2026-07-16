/**
 * Database client — single postgres.js connection for all PostgreSQL queries.
 * Replaces mongoose for data operations.
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  max: 10,
  onnotice: () => {}, // suppress notices in production
});

export default sql;
