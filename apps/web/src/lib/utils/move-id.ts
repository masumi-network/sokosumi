/** `ids` with `activeId` moved to the slot `overId` holds. */
export function moveIdToSlot(
  ids: string[],
  activeId: string,
  overId: string,
): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) {
    return ids;
  }
  const next = ids.filter((id) => id !== activeId);
  next.splice(to, 0, activeId);
  return next;
}
