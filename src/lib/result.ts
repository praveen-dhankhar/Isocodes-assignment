import type { ErrorCode } from "./errors";

export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E };

/** API_SPECS §1.1: every Server Action returns this; Route Handlers send the same `error` object. */
export type ActionResult<T> = Result<T, { code: ErrorCode; message: string; details?: unknown }>;
