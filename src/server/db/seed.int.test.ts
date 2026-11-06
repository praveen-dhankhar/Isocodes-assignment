import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { auth } from "../auth";
import { requireRole } from "../session";
import { db } from "./client";
import { importers, suppliers, user } from "./schema";
import { isLocalDatabase, seed, supplierKey } from "./seed";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // read lazily by env(); test database only
const password = () => process.env.SEED_DEMO_PASSWORD ?? "";

async function signIn(email: string) {
  const response = await auth().api.signInEmail({ body: { email, password: password() }, asResponse: true });
  return new Headers({ cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
}

describe("seed (API_SPECS §7.2)", () => {
  it("adds the demo users and masters once", async () => {
    await seed();
    expect(await seed()).toEqual({ users: 0, importers: 0, suppliers: 0 });

    const users = await db().select({ email: user.email, role: user.role }).from(user).where(inArray(user.email, ["asha@demo.test", "vikram@demo.test", "meera@demo.test"]));
    expect(users.sort((a, b) => a.email.localeCompare(b.email))).toEqual([
      { email: "asha@demo.test", role: "DOCUMENTATION_EXECUTIVE" },
      { email: "meera@demo.test", role: "DOCUMENTATION_MANAGER" },
      { email: "vikram@demo.test", role: "DOCUMENTATION_EXECUTIVE" },
    ]);
    expect(await db().select({ iec: importers.iec }).from(importers).where(inArray(importers.iec, ["TESTIEC001", "TESTIEC002", "TESTIEC003"]))).toHaveLength(3);
    const seeded = await db().select({ key: suppliers.normalizedName, country: suppliers.countryCode }).from(suppliers).where(inArray(suppliers.normalizedName, ["COMPANY B", "COMPANY G", "COMPANY H"]));
    expect(seeded.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "COMPANY B", country: "CN" },
      { key: "COMPANY G", country: "US" },
      { key: "COMPANY H", country: "JP" },
    ]);
  });

  it("seeded users sign in with their roles", async () => {
    await seed();
    expect((await requireRole("DOCUMENTATION_MANAGER", await signIn("meera@demo.test"))).name).toBe("Meera Iyer");
    const refused = await requireRole("DOCUMENTATION_MANAGER", await signIn("asha@demo.test")).catch((e: unknown) => e);
    expect(refused instanceof AppError && refused.code).toBe("FORBIDDEN");
  });

  it("matches suppliers by a normalised key", () => {
    expect(supplierKey("  company   b ")).toBe("COMPANY B");
  });

  it.each([
    ["postgres://postgres:postgres@localhost:5433/customs", true],
    ["postgres://u:p@127.0.0.1/customs", true],
    ["postgres://u:p@[::1]:5432/customs", true],
    ["postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres", false],
    ["postgres://u:p@localhost.attacker.example/x", false],
  ])("isLocalDatabase(%s) → %s", (url, expected) => {
    expect(isLocalDatabase(url)).toBe(expected);
  });
});
