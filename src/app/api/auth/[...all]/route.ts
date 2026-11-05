import { auth } from "@/server/auth";

// Better Auth's endpoints (sign-in, sign-out, session). auth() is built per first request, not at import.
export const GET = (request: Request) => auth().handler(request);
export const POST = (request: Request) => auth().handler(request);
