import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { closeDb } from "@/server/db/client";
import { isLocalDatabase, seed } from "@/server/db/seed";
import { seedScenarios } from "@/server/db/seed-scenarios";
import { env } from "@/lib/env";

// `pnpm db:reset`: drop everything, migrate, seed. Local databases only — no flag overrides this one.
async function main() {
  const url = env().DATABASE_URL;
  if (!isLocalDatabase(url)) throw new Error("Refusing to reset a non-local database");

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client`DROP SCHEMA IF EXISTS public CASCADE`;
    await client`DROP SCHEMA IF EXISTS drizzle CASCADE`; // migration journal
    await client`CREATE SCHEMA public`;
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }

  const created = await seed();
  const scenarios = await seedScenarios();
  console.log(`db:reset: migrated and seeded ${created.users} users, ${created.importers} importers, ${created.suppliers} suppliers, ${scenarios.shipments} sample shipments`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
