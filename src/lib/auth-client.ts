import { createAuthClient } from "better-auth/react";

/** Browser side of Better Auth: calls /api/auth on the current origin (sign-in, sign-out). */
export const authClient = createAuthClient();
