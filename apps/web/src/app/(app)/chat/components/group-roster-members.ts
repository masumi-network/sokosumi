import type { ChatParticipantHoverProfile } from "./room-helpers";

export interface RosterGroups {
  /** Roster humans, the viewer first, then the order they arrived in. */
  humans: ChatParticipantHoverProfile[];
  /** Coworkers and Soko Bots, in the order they arrived in. */
  agents: ChatParticipantHoverProfile[];
}

/**
 * The roster in the two halves a reader actually scans: people, then machines.
 *
 * They already arrive grouped — `getRoomParticipantPreviews` returns humans,
 * then Coworkers, then Soko Bots — but nothing said so, and at twenty members
 * the boundary was invisible. Naming the halves is what makes it readable.
 *
 * The viewer goes first among the humans. They are the one row the reader can
 * always place, and a room's own member should not have to be hunted for
 * alphabetically.
 *
 * Order is otherwise left alone: it is the caller's, and the panel is not the
 * place to re-sort people.
 */
export function groupRosterMembers(
  participants: readonly ChatParticipantHoverProfile[],
  currentUserId: string,
): RosterGroups {
  const humans: ChatParticipantHoverProfile[] = [];
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
    humans.push(participant);
  }

  return { humans: viewer ? [viewer, ...humans] : humans, agents };
}
