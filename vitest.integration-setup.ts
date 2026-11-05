import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Integration tests run against DATABASE_URL_TEST with every migration in ./drizzle applied. */
export default async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set; see README › Run locally");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
}
