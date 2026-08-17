import { getFirstName } from "@sokosumi/utils";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import type { Coworker } from "@/app/chat/utils/types";
import { canUseNextImageSrc } from "@/config/next-image";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import type { StripCoworker } from "./coworker-strip.client";

/** Given name for the landing greeting. Null → nameless greeting. */
export function resolveLandingGreetingName(
  userName: null | string | undefined,
): string | null {
  return getFirstName(userName) ?? null;
}

function coworkerPriority(coworker: Pick<Coworker, "priority">): number {
  return coworker.priority ?? 0;
}

/**
 * Higher Core `priority` first. Slug is the stable tie-break so the
 * featured face cannot flicker across renders.
 */
export function compareCoworkerRank(
  left: Pick<Coworker, "priority" | "slug">,
  right: Pick<Coworker, "priority" | "slug">,
): number {
  const byPriority = coworkerPriority(right) - coworkerPriority(left);
  if (byPriority !== 0) {
    return byPriority;
  }
  return (left.slug ?? "").localeCompare(right.slug ?? "");
}

/**
 * Shared between the desktop landing and the mobile welcome so the two cannot
 * disagree about who is featured, which faces appear, or which stats show.
 *
 * Featured = highest Core `priority`. Ties break on slug. Always the
 * optical-middle face on the strip.
 */
export function resolveFeaturedCoworker(
  coworkers: Coworker[],
): Coworker | null {
  if (coworkers.length === 0) {
    return null;
  }

  return coworkers.reduce((best, current) =>
    compareCoworkerRank(current, best) < 0 ? current : best,
  );
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
 * Diamond around the featured coworker (highest `priority`): next ranks
 * alternate left, then right, walking outward. Always an odd length so the
 * lead face is the exact centre — if the catalog is even, the lowest-priority
 * coworker is dropped. Edges are the lowest remaining ranks. Each face once.
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

  const others = coworkers
    .filter((coworker) => coworker.id !== featured.id)
    .slice()
    .sort(compareCoworkerRank);

  // featured + odd others = even total; drop the lowest rank so centre is exact.
  if (others.length % 2 === 1) {
    others.pop();
  }

  const left: Coworker[] = [];
  const right: Coworker[] = [];
  for (const [index, coworker] of others.entries()) {
    if (index % 2 === 0) {
      left.unshift(coworker);
    } else {
      right.push(coworker);
    }
  }

  return [...left, featured, ...right].map(toStripCoworker);
}

type StatsTranslator = (
  key: string,
  values?: Record<string, number | string>,
) => string;

/**
 * Chip labels for the landing activity row, in display order.
 *
 * Always returns chips — including zeros — so the first viewport keeps a
 * reserved stats footer even when the account has no activity yet (or Core
 * could not be reached). Teammates chip stays org-only.
 */
export function buildActivityStats(
  summary: TaskActivitySummary | null,
  isOrganizationWorkspace: boolean,
  t: StatsTranslator,
): string[] {
  const completed = summary?.completed ?? 0;
  const workedMinutes = summary?.workedMinutes ?? 0;
  const awaitingInput = summary?.awaitingInput ?? 0;
  const createdByOtherHumans = summary?.createdByOtherHumans ?? 0;

  return [
    t("stats.completed", { count: completed }),
    t("stats.worked", { minutes: workedMinutes }),
    t("stats.awaiting", { count: awaitingInput }),
    ...(isOrganizationWorkspace
      ? [t("stats.byTeammates", { count: createdByOtherHumans })]
      : []),
  ];
}
