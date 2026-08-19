/**
 * Temporary presentation gate. Core discovery remains enabled; only catalog
 * loading/rendering/search are disabled.
 */
export const SHOW_X402_AGENTS_IN_CATALOG = false;

export async function loadVisibleX402CatalogAgents<T>(
  load: () => Promise<T[]>,
): Promise<T[]> {
  if (!SHOW_X402_AGENTS_IN_CATALOG) {
    return [];
  }
  return await load();
}
