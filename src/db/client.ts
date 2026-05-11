import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

// DATABASE_URL must be the Supavisor pooled URL (port 6543). The `prepare:
// false` flag is required because Supavisor in transaction-pooling mode
// doesn't support prepared statements. `max` is the local socket pool size —
// with `max: 1`, every Promise.all query serializes over a single TCP
// connection, defeating the parallelism. Bump to 10 so per-request parallel
// reads actually run in parallel over the wire. Supavisor handles the
// upstream connection limit; even on Vercel serverless this is fine because
// idle connections close in 20s and each Lambda's pool is bounded.
const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });
