import type { RoomReadReceipts } from "@/app/chat/hooks/use-room-read-receipts";

import type { RoomParticipantPreview } from "./room-helpers";

/**
 * The room roster, most-recent-read first.
 *
 * One header stack answers two questions: who is in the room, and who has
 * read it. Membership decides who appears — the viewer and the machines
 * included, because it is the roster — and reading decides the order, so the
 * three faces that fit are the freshest readers and the count behind the `+N`
 * is still the room.
 *
 * Everyone the receipts say nothing about keeps the order they arrived in,
 * which is the roster's own display order: the viewer, Coworkers, Soko Bots,
 * and every member when the viewer is a guest. That makes a guest's header
 * identical to the roster it replaced, which is the point — no read state, no
 * hint that any is being withheld.
 */
export function orderRosterByReadRecency(
  participants: readonly RoomParticipantPreview[],
  receipts: Pick<RoomReadReceipts, "readStateFor">,
): RoomParticipantPreview[] {
  function readAt(participant: RoomParticipantPreview): number | null {
    if (participant.kind !== "human") {
      return null;
    }
    const state = receipts.readStateFor(participant.id);
    return state?.kind === "read" ? state.lastReadAt.getTime() : null;
  }

  // A stable sort, so anyone without a mark keeps the roster's own order.
  return participants.toSorted((a, b) => {
    const left = readAt(a);
    const right = readAt(b);
    if (left === right) {
      return 0;
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    return right - left;
  });
}
