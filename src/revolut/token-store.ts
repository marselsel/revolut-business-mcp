import { readFileSync, writeFileSync } from "node:fs";

/**
 * Persists a (possibly rotating) refresh token so it survives process restarts.
 * Revolut *may* return a new refresh token on each refresh; on a stateless host
 * the env-provided token is used each start, on a host with a volume this keeps
 * the latest one.
 */
export interface RefreshTokenStore {
  /** Return the persisted refresh token, or undefined if none/unavailable. */
  load(): string | undefined;
  /** Persist a new refresh token. Best-effort; must not throw fatally. */
  save(token: string): void;
}

/**
 * File-based store activated by `REVOLUT_TOKEN_STORE_PATH`. Use this when the host
 * has a persistent volume and you want a rotated refresh token to survive
 * restarts. On stateless hosts (e.g. default Cloud Run) leave it unset and the
 * env-provided `REVOLUT_REFRESH_TOKEN` is used at each start.
 */
export function createFileRefreshTokenStore(path: string): RefreshTokenStore {
  return {
    load() {
      try {
        const v = readFileSync(path, "utf8").trim();
        return v || undefined;
      } catch {
        return undefined;
      }
    },
    save(token: string) {
      try {
        writeFileSync(path, token, { encoding: "utf8", mode: 0o600 });
      } catch (e) {
        console.error(
          `[revolut-mcp] WARNING: could not persist refresh token to ${path}: ${
            e instanceof Error ? e.message : "unknown"
          }`,
        );
      }
    },
  };
}
