/**
 * Error raised for a failed Revolut Business API call. The message is safe to
 * surface to the model/user: it carries the HTTP status and Revolut's own
 * (non-sensitive) message, never the credentials or raw stack traces.
 */
export class RevolutApiError extends Error {
  /** HTTP status, or 0 for a network/transport error. */
  readonly status: number;
  /** A short category to help the model decide what to do next. */
  readonly kind: "validation" | "auth" | "not_found" | "rate_limited" | "upstream" | "network";

  constructor(status: number, message: string) {
    super(message);
    this.name = "RevolutApiError";
    this.status = status;
    this.kind = RevolutApiError.classify(status);
  }

  private static classify(status: number): RevolutApiError["kind"] {
    if (status === 0) return "network";
    if (status === 400 || status === 422 || status === 409) return "validation";
    if (status === 401 || status === 403) return "auth";
    if (status === 404) return "not_found";
    if (status === 429) return "rate_limited";
    return "upstream";
  }
}

/**
 * Build a safe, helpful message from a Revolut error response body. Revolut
 * typically returns `{ "message": "...", "code": <n> }` (occasionally
 * `{ "error": ... }`); we extract human-readable text and ignore the rest.
 * Falls back to the status text.
 */
export function describeErrorBody(status: number, statusText: string, body: unknown): string {
  const parts: string[] = [];
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.message === "string") parts.push(b.message);
    else if (typeof b.error === "string") parts.push(b.error);
    else if (typeof b.error_description === "string") parts.push(b.error_description);
    if (typeof b.code === "number" || typeof b.code === "string") parts.push(`code ${b.code}`);
  } else if (typeof body === "string" && body.trim() && body.length < 500) {
    parts.push(body.trim());
  }
  const detail = parts.join(" | ");
  return detail ? `Revolut API ${status}: ${detail}` : `Revolut API ${status} ${statusText}`.trim();
}
