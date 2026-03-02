export interface SearchableFeedItem {
  id: string;
  title: string | null;
  displayTitle: string | null;
  previewText: string | null;
  actor: {
    name: string | null;
  };
}

export function feedItemMatchesQuery(
  item: SearchableFeedItem,
  query: string,
): boolean {
  if (!query) return true;

  const term = query.toLowerCase();
  const searchableFields = [
    item.id,
    item.title,
    item.displayTitle,
    item.previewText,
    item.actor.name,
  ]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .map((text) => text.toLowerCase());

  return searchableFields.some((text) => text.includes(term));
}
