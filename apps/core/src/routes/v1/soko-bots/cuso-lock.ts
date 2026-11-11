import { createMiddleware } from "hono/factory";

import { requireNotCuso } from "@/services/cmo-cuso.service";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The Soko Bot writes that change Cuso himself, after `/soko-bots/{id}`:
 * archive and reactivate (the bare path), rename, version, memory, delete,
 * proactivity, board following and schedules. Turns, decisions and
 * integrations stay open: members chat with him (ADR 0061) and CMO connects
 * his measurement through `/integrations/complete-auth`.
 */
const CUSO_WRITE_PATTERNS = [
  /^$/,
  /^\/name$/,
  /^\/version$/,
  /^\/memory\/reset$/,
  /^\/permanent$/,
  /^\/proactive$/,
  /^\/board-following$/,
  /^\/schedules(\/[^/]+)?$/,
];

const SOKO_BOT_PATH = /\/soko-bots\/([0-9a-f-]{36})(\/.*)?$/i;

/** The bot a write changes Cuso through, or null for every other request. */
export function cusoLockedBotId(method: string, path: string): string | null {
  if (READ_METHODS.has(method)) return null;
  const [, sokoBotId, rest = ""] = path.match(SOKO_BOT_PATH) ?? [];
  if (!sokoBotId || !CUSO_WRITE_PATTERNS.some((pattern) => pattern.test(rest)))
    return null;
  return sokoBotId;
}

/** 409 `cmo_project_read_only` for those writes on Cuso (ADR 0066). */
export const cusoLock = createMiddleware(async (c, next) => {
  const sokoBotId = cusoLockedBotId(c.req.method, c.req.path);
  if (sokoBotId) await requireNotCuso(sokoBotId);
  await next();
});
