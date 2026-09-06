/** Non-empty assignee FK after trim (request bodies may send whitespace). */
export function hasAssigneeValue(value: string | null | undefined): boolean {
  return value != null && value.trim() !== "";
}

/** How many of the assignee FK slots are set (at most one is valid). */
export function countSetAssignees(
  ...ids: Array<string | null | undefined>
): number {
  return ids.filter(hasAssigneeValue).length;
}
