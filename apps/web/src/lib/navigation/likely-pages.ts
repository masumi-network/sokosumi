import { canPrefetchRouteContent } from "@/lib/navigation/content-prefetch-routes";
import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/utils/preference-storage";

/** How many of the reader's most visited pages stay loaded in the background. */
export const WARM_PAGE_COUNT = 3;

const VISIT_COUNTS_KEY = "sokosumi:likely-pages:v1";

/** Visits per content page path, in this browser. */
type VisitCounts = Record<string, number>;

function parseVisitCounts(raw: string): VisitCounts | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    const counts: VisitCounts = {};
    for (const [path, count] of Object.entries(parsed)) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) {
        counts[path] = count;
      }
    }
    return counts;
  } catch {
    return null;
  }
}

export function readVisitCounts(): VisitCounts {
  return readStoredPreference(VISIT_COUNTS_KEY, parseVisitCounts) ?? {};
}

/** Counts a visit to `pathname` when it is a page whose content can preload. */
export function recordVisit(pathname: string): void {
  if (!canPrefetchRouteContent(pathname)) return;
  const counts = readVisitCounts();
  counts[pathname] = (counts[pathname] ?? 0) + 1;
  writeStoredPreference(VISIT_COUNTS_KEY, JSON.stringify(counts));
}

/**
 * The most visited content pages other than the one showing, most visited
 * first. A page removed from the content list since its visits stops counting.
 */
export function likelyPages(
  counts: VisitCounts,
  currentPathname: string,
  limit = WARM_PAGE_COUNT,
): string[] {
  return Object.entries(counts)
    .filter(
      ([path]) => path !== currentPathname && canPrefetchRouteContent(path),
    )
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([path]) => path);
}
