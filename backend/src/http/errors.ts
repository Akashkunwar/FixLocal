export class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST", details?: Record<string, unknown>) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = "Authentication required", code = "UNAUTHORIZED") =>
  new HttpError(401, code, message);
export const forbidden = (message = "Forbidden", code = "FORBIDDEN", details?: Record<string, unknown>) =>
  new HttpError(403, code, message, details);
export const notFound = (message = "Not found", code = "NOT_FOUND") => new HttpError(404, code, message);
export const conflict = (message: string, code = "CONFLICT", details?: Record<string, unknown>) =>
  new HttpError(409, code, message, details);
export const tooMany = (message: string, code = "RATE_LIMITED", details?: Record<string, unknown>) =>
  new HttpError(429, code, message, details);
