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
