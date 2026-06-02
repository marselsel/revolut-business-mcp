/** Tool annotations, shared so semantics can't drift across tool files. */
export const RO = { readOnlyHint: true, openWorldHint: true, destructiveHint: false } as const;
export const WRITE = { readOnlyHint: false, openWorldHint: true, destructiveHint: false } as const;
export const DESTRUCTIVE = { readOnlyHint: false, openWorldHint: true, destructiveHint: true } as const;

/** Wrap a string as MCP text content. */
export function text(message: string): [{ type: "text"; text: string }] {
  return [{ type: "text", text: message }];
}

/**
 * Result for a list tool that returns a bare array. MCP `structuredContent` must
 * be an object, so we wrap the array as `{ items, count }` plus a summary line.
 */
export function arrayResult<T>(items: T[] | undefined, noun: string) {
  const list = Array.isArray(items) ? items : [];
  return {
    structuredContent: { items: list, count: list.length },
    content: text(`Found ${list.length} ${noun}.`),
  };
}

/** Result for a single object: pass it through as structuredContent + a one-liner. */
export function objectResult(obj: unknown, summary: string) {
  const structured = obj && typeof obj === "object" ? (obj as Record<string, unknown>) : { value: obj };
  return { structuredContent: structured, content: text(summary) };
}
