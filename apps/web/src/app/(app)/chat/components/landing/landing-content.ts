import {
  findDefaultCoworker,
  getCoworkerImageUrl,
} from "@/app/chat/utils/coworker-utils";
import type { Coworker } from "@/app/chat/utils/types";
import { canUseNextImageSrc } from "@/config/next-image";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import type { StripCoworker } from "./coworker-strip.client";

/**
 * Elena fronts the product: she is the coworker who takes a goal and turns it
 * into work, which is the idea the welcome exists to land.
 */
const FEATURED_COWORKER_SLUG = "elena";

function isElenaCoworker(coworker: Pick<Coworker, "slug">): boolean {
  return coworker.slug?.toLowerCase() === FEATURED_COWORKER_SLUG;
}

/**
 * Shared between the desktop landing and the mobile welcome so the two cannot
 * disagree about who is featured, which faces appear, or which stats show.
 */
export function resolveFeaturedCoworker(
  coworkers: Coworker[],
): Coworker | null {
  const featured = coworkers.find((coworker) => isElenaCoworker(coworker));

  // Elena is not guaranteed: `scope=available` is whitelist ∪ granted access,
  // and chat additionally needs a runnable endpoint. Lead with whoever is there.
  return featured ?? findDefaultCoworker(coworkers);
}

/**
 * Pitch under the featured face. Elena keeps product-managed copy; anyone else
 * (fallback when Elena is unavailable) uses their DB caption or nothing —
 * never Elena's gendered "Project Manager" line.
 */
export function featuredCoworkerRole(
  coworker: Coworker,
  elenaRole: string,
): string | null {
  if (isElenaCoworker(coworker)) {
    return elenaRole;
  }
  return coworker.caption ?? null;
}

function nonEmptySpecialty(value: null | string | undefined): null | string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function toStripCoworker(coworker: Coworker): StripCoworker {
  // Keyed by SLUG on purpose: the static fallback map is slug-keyed, so
  // passing the id (as most call sites do) silently yields null.
  const imageUrl = getCoworkerImageUrl(coworker.slug ?? "", coworker.avatar);

  return {
    id: coworker.id,
    // Vendors host avatars wherever they like; an unconfigured hostname makes
    // next/image throw and takes the whole page down, so fall back to initials.
    imageUrl: imageUrl && canUseNextImageSrc(imageUrl) ? imageUrl : null,
    name: coworker.name,
    title:
      nonEmptySpecialty(coworker.caption) ??
      nonEmptySpecialty(coworker.useCase) ??
      null,
  };
}

/**
 * Full catalog ordered with the featured coworker (Elena / fallback) in the
 * optical middle. Odd counts → exact centre; even → left of the two centre
 * slots (`floor(others/2)` flanks left). Never drops anyone.
 *
 * Empty when nothing is featured — the strip only renders with a lead face.
 */
export function orderStripCoworkers(
  coworkers: Coworker[],
  featured: Coworker | null,
): StripCoworker[] {
  if (!featured) {
    return [];
  }

  const others = coworkers.filter((coworker) => coworker.id !== featured.id);
  const leftCount = Math.floor(others.length / 2);
  const left = others.slice(0, leftCount);
  const right = others.slice(leftCount);

  return [...left, featured, ...right].map(toStripCoworker);
}

/**
 * Horizontal scroll offset that puts a child at the optical centre of its
 * scrollport. Clamped so short strips (or edge children) do not overscroll.
 */
export function opticalCenterScrollLeft(input: {
  childOffsetLeft: number;
  childWidth: number;
  containerWidth: number;
  scrollWidth: number;
}): number {
  const childCenter = input.childOffsetLeft + input.childWidth / 2;
  const target = childCenter - input.containerWidth / 2;
  const maxScroll = Math.max(0, input.scrollWidth - input.containerWidth);
  return Math.min(maxScroll, Math.max(0, target));
}

type StatsTranslator = (
  key: string,
  values?: Record<string, number | string>,
) => string;

/**
 * Chip labels for the "while you were gone" row, in display order.
 *
 * The teammates chip is included at zero inside an organization: "what my
 * teammates added" is a question the row should answer rather than omit.
 * Window is session-derived activity, so any non-zero metric can show.
 */
export function buildActivityStats(
  summary: TaskActivitySummary | null,
  isOrganizationWorkspace: boolean,
  t: StatsTranslator,
): string[] {
  if (!summary) {
    return [];
  }

  return [
    ...(summary.completed > 0
      ? [t("stats.completed", { count: summary.completed })]
      : []),
    ...(summary.workedMinutes > 0
      ? [t("stats.worked", { minutes: summary.workedMinutes })]
      : []),
    ...(summary.awaitingInput > 0
      ? [t("stats.awaiting", { count: summary.awaitingInput })]
      : []),
    ...(isOrganizationWorkspace
      ? [t("stats.byTeammates", { count: summary.createdByOtherHumans })]
      : []),
  ];
}

/**
 * Whether the summary has anything worth a chip row at all.
 *
 * Needs at least one non-zero metric; a lone "0 tasks from your team" chip is
 * worse than no row. Window is session-derived (last activity), not a stamped
 * visit — so there is no separate "first visit" hide.
 */
export function hasReportableActivity(
  summary: TaskActivitySummary | null,
): boolean {
  return (
    summary !== null &&
    (summary.completed > 0 ||
      summary.workedMinutes > 0 ||
      summary.awaitingInput > 0 ||
      summary.createdByOtherHumans > 0)
  );
}
