import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

/** postgres.js without prepared statements: Supabase's transaction pooler cannot keep them (ARCHITECTURE §10). */
export const createDb = (url: string) => drizzle(postgres(url, { prepare: false }), { schema });

let instance: Db | undefined;

/** Connects on first use, not at import, so `next build` runs without a database. */
export function db(): Db {
  instance ??= createDb(env().DATABASE_URL);
  return instance;
}
