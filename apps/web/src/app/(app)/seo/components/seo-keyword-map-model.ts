import type { SeoKeywordGroup } from "./seo-keyword-rows-model";

/** Below this many keywords with both numbers, a map shows no pattern: the list says it all. */
const MIN_POINTS = 2;
/** Dot radius in px: 4 keeps the smallest dot at the 8 px a pointer and an eye find; 14 keeps big dots apart. */
export const SEO_MAP_MIN_RADIUS = 4;
const MAX_RADIUS = 14;

export interface SeoKeywordPoint {
  group: SeoKeywordGroup;
  /** A keyword the check read or the reader tracks; false for an idea. */
  checked: boolean;
  volume: number;
  difficulty: number;
  /** Extra monthly clicks at place 10 and at place 3 over now; 0 where the keyword is there already. */
  gain: { top10: number; top3: number } | null;
  /** Left edge to right edge, 0 to 100: the difficulty. */
  x: number;
  /** Top to bottom, 0 to 100: more searches higher, on a log scale. */
  y: number;
  radius: number;
}

/**
 * Searches a month against keyword difficulty, one dot per keyword with both numbers. Searches use a log
 * scale: 50 and 50,000 searches both stay readable. The dot area grows with the extra clicks place 3 brings:
 * clicks fall steeply after the first places, so a top 3 place is the prize, not a place on page 1.
 */
export function seoKeywordMap(groups: {
  checked: SeoKeywordGroup[];
  ideas: SeoKeywordGroup[];
}) {
  const rows = [
    ...groups.checked.map((group) => ({ group, checked: true })),
    ...groups.ideas.map((group) => ({ group, checked: false })),
  ].flatMap(({ group, checked }) =>
    group.volume !== null && group.volume > 0 && group.difficulty !== null
      ? [{ group, checked, volume: group.volume, difficulty: group.difficulty }]
      : [],
  );
  if (rows.length < MIN_POINTS) return null;
  const decades = rows.map((row) => Math.log10(row.volume));
  const low = Math.floor(Math.min(...decades));
  // One decade at least: equal volumes still get an axis.
  const high = Math.max(Math.ceil(Math.max(...decades)), low + 1);
  const gainOf = (clicks: SeoKeywordGroup["clicks"]) =>
    clicks && {
      top10: Math.max(clicks.top10 - clicks.now, 0),
      top3: Math.max(clicks.top3 - clicks.now, 0),
    };
  const most = Math.max(
    ...rows.map((row) => gainOf(row.group.clicks)?.top3 ?? 0),
  );
  const points: SeoKeywordPoint[] = rows.map((row) => {
    const gain = gainOf(row.group.clicks);
    return {
      ...row,
      gain,
      x: row.difficulty,
      y: 100 - ((Math.log10(row.volume) - low) / (high - low)) * 100,
      radius:
        SEO_MAP_MIN_RADIUS +
        (most > 0 ? Math.sqrt((gain?.top3 ?? 0) / most) : 0) *
          (MAX_RADIUS - SEO_MAP_MIN_RADIUS),
    };
  });
  return {
    // Left to right, so the arrow keys walk the map as the eye reads it.
    points: points.toSorted(
      (left, right) => left.x - right.x || left.y - right.y,
    ),
    ticks: Array.from({ length: high - low + 1 }, (_, index) => ({
      value: 10 ** (low + index),
      y: 100 - (index / (high - low)) * 100,
    })),
  };
}

/**
 * Keywords with searches that the map cannot place: their audit gave no difficulty. The map then says when it
 * comes, so the reader knows where it is.
 */
export function seoKeywordMapWaits(groups: {
  checked: SeoKeywordGroup[];
  ideas: SeoKeywordGroup[];
}) {
  const all = [...groups.checked, ...groups.ideas];
  const searched = all.filter(
    (group) => group.volume !== null && group.volume > 0,
  );
  return (
    searched.length >= MIN_POINTS &&
    all.every((group) => group.difficulty === null)
  );
}

/** The point nearest to a spot on the map, in px, when it is within reach of the pointer. */
export function seoNearestPoint(
  points: SeoKeywordPoint[],
  at: { x: number; y: number },
  size: { width: number; height: number },
  reach: number,
) {
  let nearest: { index: number; distance: number } | null = null;
  points.forEach((point, index) => {
    const distance = Math.hypot(
      ((point.x - at.x) / 100) * size.width,
      ((point.y - at.y) / 100) * size.height,
    );
    if (
      distance <= Math.max(reach, point.radius) &&
      (!nearest || distance < nearest.distance)
    )
      nearest = { index, distance };
  });
  return (nearest as { index: number } | null)?.index ?? null;
}
