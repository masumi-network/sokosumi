import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import { actsForOwner } from "./acting-scope";

/**
 * When a Soko Bot may change a Task Schedule, in one place so the list
 * (`youCanChange`) and the tools that write agree.
 */

/** A personal bot on its owner's turn keeps the owner's Task Schedules. */
export function keepsOwnersTaskSchedules(
  authorized: AuthorizedSokoBotRuntime,
): boolean {
  return (
    !authorized.reader.sharedScope &&
    authorized.turn.actingUserId !== null &&
    actsForOwner(authorized)
  );
}

/** The owner's own chat turn, the only one that may change someone else's schedule. */
export function ownersOwnChat(authorized: AuthorizedSokoBotRuntime): boolean {
  return (
    authorized.turn.source === "CHAT" &&
    authorized.turn.chainDepth === 0 &&
    authorized.askedByKind === "OWNER"
  );
}

/** Made by the owner or by this bot. */
export function isOursTaskSchedule(
  authorized: AuthorizedSokoBotRuntime,
  schedule: { creatorUserId: string | null; creatorSokoBotId: string | null },
): boolean {
  return (
    (schedule.creatorUserId !== null &&
      schedule.creatorUserId === authorized.turn.actingUserId) ||
    schedule.creatorSokoBotId === authorized.turn.sokoBotId
  );
}

/**
 * What the list says: the owner may write it (the Schedules page rule), this
 * turn may keep the owner's schedules, and someone else's needs the owner's
 * yes first, which only their own chat turn can act on.
 */
export function taskScheduleAccess(
  authorized: AuthorizedSokoBotRuntime,
  schedule: { creatorUserId: string | null; creatorSokoBotId: string | null },
  ownerCanWrite: boolean,
): { youCanChange: boolean; askOwnerFirst: boolean } {
  if (!ownerCanWrite || !keepsOwnersTaskSchedules(authorized))
    return { youCanChange: false, askOwnerFirst: false };
  const ours = isOursTaskSchedule(authorized, schedule);
  return {
    youCanChange: ours || ownersOwnChat(authorized),
    askOwnerFirst: !ours,
  };
}
