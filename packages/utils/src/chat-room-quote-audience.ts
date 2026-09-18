/**
 * A room message may be quoted into another room only when every human reader
 * of the target room can also read the source room, so the snippet never
 * reaches someone who cannot follow the Message link. The sender's Self Direct
 * passes because its only reader is the sender, who reads the source room.
 */
export function canQuoteIntoRoom(
  targetMemberUserIds: readonly string[],
  sourceMemberUserIds: readonly string[],
): boolean {
  const sourceReaders = new Set(sourceMemberUserIds);
  return targetMemberUserIds.every((userId) => sourceReaders.has(userId));
}
