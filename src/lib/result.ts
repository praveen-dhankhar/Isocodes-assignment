import { unstable_rethrow } from "next/navigation";
import { toErrorBody, type ErrorBody } from "./errors";

export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E };

/** API_SPECS §1.1: every Server Action returns this; Route Handlers send the same `error` object. */
export type ActionResult<T> = Result<T, ErrorBody>;

/**
 * Wraps a Server Action body (Zod-validate → requireUser/requireRole → one service call) into an ActionResult.
 * Next.js control-flow throws (redirect, notFound) pass through untouched.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await body() };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toErrorBody(e).error };
  }
}
