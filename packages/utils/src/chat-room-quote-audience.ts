/**
 * Public and external Channels: any member of the owning organization may join
 * on their own, so every organization member can read them, on the roster or
 * not. Private Channels are roster-only for plain members.
 */
export function isSelfJoinableChannelDiscoverability(
  discoverability: string | null,
): boolean {
  return discoverability === "public" || discoverability === "external";
}

/**
 * A room message may be quoted into another room only when every human reader
 * of the target room can also read the source room, so the snippet never
 * reaches someone who cannot follow the Message link. `sourceReaderUserIds` is
 * the source room's roster plus, for a self-joinable Channel, the target
 * readers who belong to its organization. The sender's Self Direct passes
 * because its only reader is the sender, who reads the source room.
 */
export function canQuoteIntoRoom(
  targetMemberUserIds: readonly string[],
  sourceReaderUserIds: readonly string[],
): boolean {
  const sourceReaders = new Set(sourceReaderUserIds);
  return targetMemberUserIds.every((userId) => sourceReaders.has(userId));
}
