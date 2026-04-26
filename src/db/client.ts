import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

// DATABASE_URL must be the Supavisor pooled URL (port 6543). The `prepare:
// false` flag is required because Supavisor in transaction-pooling mode
// doesn't support prepared statements. We cap `max` at 1 connection per
// serverless invocation — Supavisor is the real pool, this client just holds
// one socket per Lambda — and use a short idle timeout so we don't hold the
// socket between requests longer than necessary.
const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });
