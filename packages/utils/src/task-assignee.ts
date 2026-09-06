/** Non-empty assignee FK after trim (request bodies may send whitespace). */
export function hasAssigneeValue(value: string | null | undefined): boolean {
  return value != null && value.trim() !== "";
}

/** How many of the assignee FK slots are set (at most one is valid). */
export function countSetAssignees(
  ...ids: Array<string | null | undefined>
): number {
  let count = 0;
  for (const id of ids) {
    if (hasAssigneeValue(id)) {
      count += 1;
    }
  }
  return count;
}
