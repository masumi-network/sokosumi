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

/** Who a replay token is for: a person, or a Coworker (a Buzz agent). */
type ReplayActor =
  | { userId: string }
  | { coworkerId: string }
  | { sokoBotId: string };

export function bridgeReplayActor(actor: ReplayActor): string {
  if ("userId" in actor) return actor.userId;
  if ("coworkerId" in actor) return `coworker:${actor.coworkerId}`;
  return `soko-bot:${actor.sokoBotId}`;
}

/**
 * A `buzz:<event id>` client message id names a Buzz event; only the bridge
 * may claim one, for the actor it replays, or someone could claim another
 * person's event before it arrives.
 */
export function mayUseClientMessageId(
  clientMessageId: string | null | undefined,
  actor: ReplayActor,
  header: string | undefined,
): boolean {
  if (!clientMessageId?.trim().startsWith("buzz:")) return true;
  return isBridgeReplay(bridgeReplayActor(actor), header);
}
