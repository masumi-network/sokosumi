/**
 * Marks a request as the Buzz bridge replaying what someone did in their Buzz
 * app, so Core can tell it from the same person's own API key.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/config/env";

export const BUZZ_BRIDGE_REPLAY_HEADER = "x-buzz-bridge-replay";

export function bridgeReplayToken(userId: string): string | null {
  const secret = getEnv().BUZZ_KEY_ENCRYPTION_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`buzz-bridge-replay:${userId}`)
    .digest("hex");
}

export function isBridgeReplay(
  userId: string,
  header: string | undefined,
): boolean {
  const expected = bridgeReplayToken(userId);
  if (!expected || !header || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
