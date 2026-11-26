/** Collect one scoped collection without treating a partial page as the full list. */
export async function collectCursorPages<T>(
  first: T[],
  nextCursor: string | null | undefined,
  load: (cursor: string) => Promise<{ items: T[]; nextCursor?: string | null }>,
): Promise<T[]> {
  if (!nextCursor) return first;
  const items = [...first];
  const seen = new Set<string>();
  let cursor: string | null | undefined = nextCursor;
  while (cursor) {
    if (seen.has(cursor)) throw new Error("Pagination cursor did not advance");
    seen.add(cursor);
    const page = await load(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  return items;
}
