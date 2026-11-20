interface SearchFields {
  primary: readonly (string | null | undefined)[];
  secondary?: readonly (string | null | undefined)[];
}

/** Keep the page's own ordering within each group of equally relevant hits. */
export function rankPageItems<T>(
  items: readonly T[],
  query: string,
  fieldsFor: (item: T) => SearchFields,
): T[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  if (!words[0]) return [...items];

  const primaryHits: T[] = [];
  const secondaryHits: T[] = [];
  for (const item of items) {
    const fields = fieldsFor(item);
    const primary = fields.primary.join(" ").toLowerCase();
    if (words.every((word) => primary.includes(word))) {
      primaryHits.push(item);
      continue;
    }
    const secondary = fields.secondary?.join(" ").toLowerCase() ?? "";
    if (
      words.every((word) => primary.includes(word) || secondary.includes(word))
    ) {
      secondaryHits.push(item);
    }
  }
  return primaryHits.concat(secondaryHits);
}
