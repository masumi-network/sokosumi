import { getFirstName } from "@sokosumi/utils";

import {
  findDefaultCoworker,
  getCoworkerImageUrl,
} from "@/app/chat/utils/coworker-utils";
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

function coworkerRank(coworker: Pick<Coworker, "priority">): number {
  return coworker.priority ?? 0;
}

/**
 * Highest Core `priority` first (same key as GET /v1/coworkers). That field
 * is an editorial list rank, not a usage counter. Slug is the stable
 * tie-break so the featured face cannot flicker across renders.
 */
export function compareCoworkerRank(
  left: Pick<Coworker, "priority" | "slug">,
  right: Pick<Coworker, "priority" | "slug">,
): number {
  const byPriority = coworkerRank(right) - coworkerRank(left);
  if (byPriority !== 0) {
    return byPriority;
  }
  return (left.slug ?? "").localeCompare(right.slug ?? "");
}

/**
 * Shared between the desktop landing and the mobile welcome so the two cannot
 * disagree about who is featured, which faces appear, or which stats show.
 *
 * Featured = highest Core `priority` among available chat coworkers. When
 * every row is still the default `0` (fresh / local DBs), keep Elena via
 * `findDefaultCoworker` so the welcome does not flip to the first slug.
 */
export function resolveFeaturedCoworker(
  coworkers: Coworker[],
): Coworker | null {
  if (coworkers.length === 0) {
    return null;
  }

  const allDefaultRank = coworkers.every(
    (coworker) => coworkerRank(coworker) === 0,
  );
  if (allDefaultRank) {
    return findDefaultCoworker(coworkers);
  }

  return coworkers.reduce((best, current) =>
    compareCoworkerRank(current, best) < 0 ? current : best,
  );
}

/**
 * Body copy above Start chat. First sentence of DB `description` only —
 * never caption/useCase. Name + role stay under the strip avatar.
 */
export function selectedCoworkerDescription(
  coworker: Pick<Coworker, "description">,
): string | null {
  const specialty = nonEmptySpecialty(coworker.description);
  return specialty ? shortLandingSentence(specialty) : null;
}

/** One short sentence on the landing — fits two lines in the `max-w-xs` slot. */
export const LANDING_DESCRIPTION_MAX_CHARS = 72;

/**
 * Truncate a landing description for the collapsed state.
 * Returns the full string when it already fits; otherwise a word-aware preview
 * capped near `maxChars` with an ellipsis, and `isTruncated: true`.
 */
export function clampLandingDescription(
  description: string,
  maxChars: number = LANDING_DESCRIPTION_MAX_CHARS,
): { isTruncated: boolean; preview: string } {
  if (description.length <= maxChars) {
    return { isTruncated: false, preview: description };
  }

  const slice = description.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut =
    lastSpace > Math.floor(maxChars * 0.6) ? slice.slice(0, lastSpace) : slice;

  return { isTruncated: true, preview: `${cut.trimEnd()}…` };
}

const LEADING_ABBREVIATION =
  /^(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|etc|Inc|Ltd)\.$/i;

function getSentenceSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
    return null;
  }
  return new Intl.Segmenter("en", { granularity: "sentence" });
}

function firstSentenceFallback(text: string): string {
  const match = text.match(/^[\s\S]+?(?:[.!?](?=\s+[A-Z])|[.!?]$)/);
  return (match?.[0] ?? text).trim();
}

function firstSentence(text: string): string {
  const segmenter = getSentenceSegmenter();
  if (!segmenter) {
    return firstSentenceFallback(text);
  }

  const parts = Array.from(segmenter.segment(text), (part) => part.segment);
  if (parts.length === 0) {
    return text;
  }

  let index = 0;
  let sentence = parts[0] ?? "";
  while (
    LEADING_ABBREVIATION.test(sentence.trim()) &&
    index + 1 < parts.length
  ) {
    index += 1;
    sentence += parts[index];
  }

  return sentence.trim();
}

/**
 * First sentence of a coworker blurb, still capped at the landing budget.
 * Uses `Intl.Segmenter` and stitches title abbreviations (`Dr.`, `Prof.`)
 * back onto the following sentence.
 */
export function shortLandingSentence(
  description: string,
  maxChars: number = LANDING_DESCRIPTION_MAX_CHARS,
): string {
  const trimmed = description.trim();
  if (!trimmed) {
    return "";
  }

  const sentence = firstSentence(trimmed);

  if (sentence.length <= maxChars) {
    return sentence;
  }

  return clampLandingDescription(sentence, maxChars).preview;
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
 * Full catalog ordered by popularity, with the featured coworker (highest
 * `priority`) in the optical middle. Odd counts → exact centre; even → left
 * of the two centre slots (`floor(others/2)` flanks left). Never drops anyone.
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
  const leftCount = Math.floor(others.length / 2);
  const left = others.slice(0, leftCount);
  const right = others.slice(leftCount);

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
