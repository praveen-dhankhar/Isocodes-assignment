import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import type { Role } from "@/domain/status";
import { AppError } from "@/lib/errors";
import { auth, ROLES } from "./auth";

const SessionUser = z.object({ id: z.string(), email: z.string(), name: z.string(), role: z.enum(ROLES) });
export type SessionUser = z.infer<typeof SessionUser>;

/** The signed-in user or null. Uses the current request's headers unless given some (integration tests). */
export async function getUser(requestHeaders?: Headers): Promise<SessionUser | null> {
  const session = await auth().api.getSession({ headers: requestHeaders ?? (await headers()) });
  return session ? SessionUser.parse(session.user) : null;
}

/** First line of every Server Action and Route Handler (API_SPECS §1): no session → 401 UNAUTHENTICATED. */
export async function requireUser(requestHeaders?: Headers): Promise<SessionUser> {
  const user = await getUser(requestHeaders);
  if (!user) throw new AppError("UNAUTHENTICATED", "Sign in to continue");
  return user;
}

/** Role-restricted actions (PRD §11): wrong role → 403 FORBIDDEN. */
export async function requireRole(role: Role, requestHeaders?: Headers): Promise<SessionUser> {
  const user = await requireUser(requestHeaders);
  if (user.role !== role) throw new AppError("FORBIDDEN", "Your role does not allow this");
  return user;
}
