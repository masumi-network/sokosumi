import type { RoomReadReceipts } from "@/app/chat/hooks/use-room-read-receipts";

import { orderRosterByReadRecency } from "./order-roster-by-read-recency";
import type { ChatParticipantHoverProfile } from "./room-helpers";

export interface RosterGroups {
  /**
   * Roster humans the panel lists first: the viewer, then everyone with a
   * Room last-read, freshest first. A guest's roster lands here whole, since
   * they are told nothing about anyone's reading.
   */
  people: ChatParticipantHoverProfile[];
  /** Roster humans who have never opened the room, in the order given. */
  neverRead: ChatParticipantHoverProfile[];
  /** Coworkers and Soko Bots, in the order they arrived in. */
  agents: ChatParticipantHoverProfile[];
}

/**
 * The roster in the order a reader scans it: people who have read, people who
 * have not, then machines.
 *
 * Members already arrive grouped by kind — `getRoomParticipantPreviews`
 * returns humans, then Coworkers, then Soko Bots — but nothing said so, and at
 * twenty members the boundary was invisible. Naming the parts is what makes it
 * readable.
 *
 * The viewer goes first and stays there whatever their own mark says. Theirs
 * is the one row a reader can always place, and their own read time tells them
 * nothing they do not already know.
 *
 * Everyone else with a mark follows by how recently they read — the same order
 * the header stack shows, so the faces and the top of the list agree about who
 * is freshest. Those with no mark gather at the end of the people, where one
 * subheading can say "not read yet" instead of every row repeating it.
 *
 * A member the receipts say nothing about is not never-read: that is what a
 * guest sees for the whole roster, and for them this collapses back to the
 * plain list it replaced.
 *
 * Machines never carry a mark and none is invented for them, so they keep the
 * order they arrived in.
 */
export function groupRosterMembers(
  participants: readonly ChatParticipantHoverProfile[],
  currentUserId: string,
  receipts: Pick<RoomReadReceipts, "readStateFor">,
): RosterGroups {
  const withMark: ChatParticipantHoverProfile[] = [];
  const neverRead: ChatParticipantHoverProfile[] = [];
  const agents: ChatParticipantHoverProfile[] = [];
  let viewer: ChatParticipantHoverProfile | null = null;

  for (const participant of participants) {
    if (participant.kind !== "human") {
      agents.push(participant);
      continue;
    }
    if (participant.id === currentUserId) {
      viewer = participant;
      continue;
    }
    if (receipts.readStateFor(participant.id)?.kind === "unread") {
      neverRead.push(participant);
      continue;
    }
    withMark.push(participant);
  }

  const byReadRecency = orderRosterByReadRecency(withMark, receipts);
  return {
    people: viewer ? [viewer, ...byReadRecency] : byReadRecency,
    neverRead,
    agents,
  };
}
