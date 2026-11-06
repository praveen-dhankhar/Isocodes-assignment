import "server-only";
import { eq, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { identifierKey, normalizeText } from "@/domain/normalize/text";
import type { Role } from "@/domain/status";
import { env } from "@/lib/env";
import { auth } from "../auth";
import { closeDb, db } from "./client";
import { importers, suppliers, user } from "./schema";

// API_SPECS §7.2: users and masters only; shipments are seeded through the real pipeline later (M6).
// Everything here is invented (A-13): @example.test / @demo.test addresses, +91 90000 0000x numbers.

const USERS: Array<{ email: string; name: string; role: Role }> = [
  { email: "asha@demo.test", name: "Asha Rao", role: "DOCUMENTATION_EXECUTIVE" },
  { email: "vikram@demo.test", name: "Vikram Shah", role: "DOCUMENTATION_EXECUTIVE" },
  { email: "meera@demo.test", name: "Meera Iyer", role: "DOCUMENTATION_MANAGER" },
];

const IMPORTERS = [
  { name: "Company P", iec: "TESTIEC001", contactName: "Imports desk, Company P", contactEmail: "imports.p@example.test", contactPhone: "+91 90000 00001" },
  { name: "Company Q", iec: "TESTIEC002", contactName: "Imports desk, Company Q", contactEmail: "imports.q@example.test", contactPhone: "+91 90000 00002" },
  { name: "Company R", iec: "TESTIEC003", contactName: "Imports desk, Company R", contactEmail: "imports.r@example.test", contactPhone: "+91 90000 00003" },
];

const SUPPLIERS: Array<[name: string, countryCode: string]> = [
  ["Company B", "CN"], ["Company C", "SE"], ["Company D", "DE"], ["Company E", "TW"],
  ["Company F", "TH"], ["Company G", "US"], ["Company H", "JP"],
];

/** Supplier match key: whitespace collapsed, compared in uppercase like identifiers (PRD §7). */
export const supplierKey = (name: string) => identifierKey(normalizeText(name) ?? "");

/** Seeding and resets touch only a database on this machine unless explicitly allowed. */
export function isLocalDatabase(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Idempotent: existing rows are kept, missing ones added. */
export async function seed(): Promise<{ users: number; importers: number; suppliers: number }> {
  const password = env().SEED_DEMO_PASSWORD;
  if (!password) throw new Error("SEED_DEMO_PASSWORD is not set; the demo users need a password");

  // Users go through Better Auth (sign-up is disabled), so passwords use its own hasher and sign-in works.
  const ctx = await auth().$context;
  let createdUsers = 0;
  for (const u of USERS) {
    const [existing] = await db().select({ id: user.id }).from(user).where(eq(user.email, u.email));
    if (existing) continue;
    const created = await ctx.internalAdapter.createUser({ ...u, emailVerified: true }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({ userId: created.id, providerId: "credential", accountId: created.id, password: await ctx.password.hash(password) });
    createdUsers++;
  }

  let createdImporters = 0;
  for (const i of IMPORTERS) {
    const [existing] = await db().select({ id: importers.id }).from(importers).where(eq(importers.iec, i.iec));
    if (existing) continue;
    await db().insert(importers).values(i);
    createdImporters++;
  }

  const insertedSuppliers = await db()
    .insert(suppliers)
    .values(SUPPLIERS.map(([name, countryCode]) => ({ name, countryCode, normalizedName: supplierKey(name) })))
    .onConflictDoNothing({ target: suppliers.normalizedName })
    .returning({ id: suppliers.id });

  return { users: createdUsers, importers: createdImporters, suppliers: insertedSuppliers.length };
}

/** `pnpm db:seed [--allow-remote]` */
async function main() {
  const url = env().DATABASE_URL;
  if (!isLocalDatabase(url) && !process.argv.includes("--allow-remote")) {
    throw new Error("Refusing to seed a non-local database; pass --allow-remote if you mean it");
  }
  const created = await seed();
  const [counts] = await db().execute<{ users: number; importers: number; suppliers: number }>(
    sql`select (select count(*) from "user")::int as users, (select count(*) from importers)::int as importers, (select count(*) from suppliers)::int as suppliers`,
  );
  console.log(`seed: added ${created.users} users, ${created.importers} importers, ${created.suppliers} suppliers; now ${JSON.stringify(counts)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
