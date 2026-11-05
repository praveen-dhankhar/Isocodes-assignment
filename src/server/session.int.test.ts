import { describe, expect, it } from "vitest";
import type { Role } from "@/domain/status";
import { AppError } from "@/lib/errors";
import { auth } from "./auth";
import { requireRole, requireUser } from "./session";

const PASSWORD = "integration-test-password"; // test database only

/** Users exist only by seeding (sign-up is disabled): create one the way the seed will, with Better Auth's hasher. */
async function createUser(role: Role) {
  const ctx = await auth().$context;
  const email = `${role.toLowerCase()}-${crypto.randomUUID()}@int.test`;
  const user = await ctx.internalAdapter.createUser({ email, name: "Integration test", emailVerified: true, role }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await ctx.password.hash(PASSWORD) });
  return { id: user.id, email };
}

/** Signs in through the real endpoint and returns request headers carrying the session cookie. */
async function signIn(email: string, password = PASSWORD) {
  const response = await auth().api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { status: response.status, headers: new Headers({ cookie }) };
}

const errorCode = (promise: Promise<unknown>) =>
  promise.then(() => "resolved", (e: unknown) => (e instanceof AppError ? e.code : String(e)));

describe("session (Better Auth, PRD §11)", () => {
  it("returns the signed-in user with their role", async () => {
    const { id, email } = await createUser("DOCUMENTATION_EXECUTIVE");
    const { headers } = await signIn(email);
    expect(await requireUser(headers)).toMatchObject({ id, email, role: "DOCUMENTATION_EXECUTIVE" });
  });

  it("rejects a request without a session as UNAUTHENTICATED", async () => {
    expect(await errorCode(requireUser(new Headers()))).toBe("UNAUTHENTICATED");
  });

  it("refuses a manager-only action to an executive with FORBIDDEN", async () => {
    const { email } = await createUser("DOCUMENTATION_EXECUTIVE");
    const { headers } = await signIn(email);
    expect(await errorCode(requireRole("DOCUMENTATION_MANAGER", headers))).toBe("FORBIDDEN");
  });

  it("lets a manager through", async () => {
    const { email } = await createUser("DOCUMENTATION_MANAGER");
    const { headers } = await signIn(email);
    expect((await requireRole("DOCUMENTATION_MANAGER", headers)).role).toBe("DOCUMENTATION_MANAGER");
  });

  it("rejects a wrong password", async () => {
    const { email } = await createUser("DOCUMENTATION_EXECUTIVE");
    expect((await signIn(email, "not-the-password")).status).toBe(401);
  });

  it("does not let anyone sign up (A-24)", async () => {
    const attempt = auth().api.signUpEmail({ body: { email: `new-${crypto.randomUUID()}@int.test`, password: PASSWORD, name: "New" }, asResponse: true });
    expect((await attempt).status).toBeGreaterThanOrEqual(400);
  });
});
