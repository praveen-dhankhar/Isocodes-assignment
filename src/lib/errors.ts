import { ZodError } from "zod";

// API_SPECS §1.2. `null` = stored on a document (`documents.error_code`), never sent as an HTTP error.
export const ERROR_HTTP_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SELF_APPROVAL_FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  PAGE_LIMIT_EXCEEDED: 422,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 409,
  HUMAN_EDITS_EXIST: 409,
  EXPORT_BLOCKED: 409,
  AI_NOT_CONFIGURED: null,
  AI_UNAVAILABLE: null,
  AI_RATE_LIMITED: null,
  AI_INVALID_OUTPUT: null,
  AI_TIMEOUT: null,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Thrown by services; actions and routes turn it into an `ActionResult` error or an HTTP error body. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Any thrown value → the API error body and HTTP status (API_SPECS §1.1–1.2). Zod failures are VALIDATION_FAILED with
 * the issue paths. Anything unexpected is INTERNAL: logged with a request id and the error's name only — never its
 * message, which can carry document text or SQL values.
 */
export function toErrorBody(e: unknown): { status: number; error: ErrorBody } {
  if (e instanceof AppError) {
    return { status: ERROR_HTTP_STATUS[e.code] ?? 500, error: { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) } };
  }
  if (e instanceof ZodError) {
    const details = e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return { status: 422, error: { code: "VALIDATION_FAILED", message: "Some of the input is not valid", details } };
  }
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ event: "internal_error", requestId, name: e instanceof Error ? e.name : typeof e }));
  return { status: 500, error: { code: "INTERNAL", message: `Something went wrong (reference ${requestId})` } };
}

/** For Route Handlers: `catch (e) { return errorResponse(e) }`. */
export function errorResponse(e: unknown): Response {
  const { status, error } = toErrorBody(e);
  return Response.json({ error }, { status });
}
