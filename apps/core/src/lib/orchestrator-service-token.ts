import { timingSafeEqual } from "node:crypto";

import { getEnv } from "@/config/env";

/**
 * Constant-time compare of bearer token to the global orchestrator service
 * secret (`ORCHESTRATOR_SERVICE_TOKEN`). Used by Hermes → Core auth.
 */
export function isOrchestratorServiceToken(token: string): boolean {
  const expected = getEnv().ORCHESTRATOR_SERVICE_TOKEN;
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);

  if (tokenBuf.length !== expectedBuf.length) {
    // Keep a fixed comparison when lengths differ (still not perfect, but
    // avoids early-return on length alone without any crypto work).
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return timingSafeEqual(tokenBuf, expectedBuf);
}
