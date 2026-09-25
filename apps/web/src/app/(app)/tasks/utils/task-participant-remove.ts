/**
 * Who may remove a Task participant row.
 * Owner: any row. Participant: only their own. Else: nobody.
 */
export function canRemoveTaskParticipant(args: {
  viewerId: string | null | undefined;
  ownerId: string;
  participantUserId: string;
  viewerIsParticipant: boolean;
}): boolean {
  const { viewerId, ownerId, participantUserId, viewerIsParticipant } = args;
  if (!viewerId) {
    return false;
  }
  if (viewerId === ownerId) {
    return true;
  }
  return viewerIsParticipant && viewerId === participantUserId;
}
