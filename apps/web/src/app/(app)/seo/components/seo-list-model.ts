/** Rows a long list shows before its "Show more" button. */
export const SEO_LIST_PAGE_SIZE = 10;

/**
 * How many rows of a list show before its fold. A fold that would hide one row hides none: its button takes the
 * room of that row and asks for a press.
 */
export function seoFoldCount(total: number, size = SEO_LIST_PAGE_SIZE) {
  return total > size + 1 ? size : total;
}
