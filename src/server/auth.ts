import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import type { Role } from "@/domain/status";
import { env } from "@/lib/env";
import { db } from "./db/client";
import * as schema from "./db/schema";

export const ROLES = ["DOCUMENTATION_EXECUTIVE", "DOCUMENTATION_MANAGER"] as const satisfies readonly Role[];

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "Customs cross-check",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), { provider: "pg", schema }),
    emailAndPassword: { enabled: true, disableSignUp: true }, // A-24: seeded users only
    user: {
      // input: false — nobody can set their own role through an auth endpoint.
      additionalFields: { role: { type: [...ROLES], required: true, input: false } },
    },
    // Login rate limits live in Postgres: in-memory counters reset with every serverless instance.
    rateLimit: { storage: "database" },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Built on first use (needs the database and secrets), so `next build` runs without them. */
export function auth() {
  instance ??= createAuth();
  return instance;
}
