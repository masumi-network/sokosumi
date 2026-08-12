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

/**
 * Shared between the desktop landing and the mobile welcome so the two cannot
 * disagree about who is featured, which faces appear, or which stats show.
 */
export function resolveFeaturedCoworker(
  coworkers: Coworker[],
): Coworker | null {
  const featured = coworkers.find(
    (coworker) => coworker.slug?.toLowerCase() === FEATURED_COWORKER_SLUG,
  );

  // Elena is not guaranteed: `scope=available` is whitelist ∪ granted access,
  // and chat additionally needs a runnable endpoint. Lead with whoever is there.
  return featured ?? findDefaultCoworker(coworkers);
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
    title: coworker.caption ?? null,
  };
}

/**
 * The teammates flanking the featured coworker.
 *
 * `max` is even on the desktop strip so the flanks balance and the featured
 * face stays optically centred; the odd one out is dropped rather than seated
 * on one side. The mobile row scrolls instead of centring, so it passes an odd
 * `max` happily.
 */
export function selectStripCoworkers(
  coworkers: Coworker[],
  featured: Coworker | null,
  max: number,
  { keepEven = true }: { keepEven?: boolean } = {},
): StripCoworker[] {
  if (!featured) {
    return [];
  }

  const others = coworkers.filter((coworker) => coworker.id !== featured.id);
  const limit = keepEven
    ? Math.min(max, others.length - (others.length % 2))
    : Math.min(max, others.length);

  return others.slice(0, Math.max(0, limit)).map(toStripCoworker);
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
