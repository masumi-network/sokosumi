/**
 * Pure geometry for scroll → select on the landing coworker strip.
 * Pick the item whose horizontal center is nearest the scrollport center.
 */

export interface CenterCandidate {
  id: string;
  /** Item midpoint in the same coordinate space as `viewportCenterX`. */
  centerX: number;
}

/**
 * Returns the id of the candidate nearest `viewportCenterX`, or null when
 * there are no candidates. Ties keep the earlier candidate (stable).
 */
export function findNearestCenterId(
  viewportCenterX: number,
  candidates: readonly CenterCandidate[],
): null | string {
  if (candidates.length === 0) {
    return null;
  }

  let bestId = candidates[0].id;
  let bestDistance = Math.abs(candidates[0].centerX - viewportCenterX);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const distance = Math.abs(candidate.centerX - viewportCenterX);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = candidate.id;
    }
  }

  return bestId;
}

/**
 * Measures the scrollport and item elements, then returns the nearest-center id.
 */
export function findNearestCenterIdFromElements(
  scrollport: HTMLElement,
  items: Iterable<readonly [string, HTMLElement]>,
): null | string {
  const portRect = scrollport.getBoundingClientRect();
  const viewportCenterX = portRect.left + portRect.width / 2;
  const candidates: CenterCandidate[] = [];

  for (const [id, element] of items) {
    const rect = element.getBoundingClientRect();
    candidates.push({
      id,
      centerX: rect.left + rect.width / 2,
    });
  }

  return findNearestCenterId(viewportCenterX, candidates);
}
