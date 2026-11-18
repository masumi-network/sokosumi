import { z } from "@hono/zod-openapi";

import { seoUrlSchema } from "@/schemas/project-seo.schema";
import {
  importedSeoForumQuestions,
  SEO_STRATEGY_DRAFT_MAX_LENGTH,
  SEO_STRATEGY_PLACES_NOTES_MAX,
  SEO_STRATEGY_TEXT_MAX_LENGTH,
  type SeoStrategyPayload,
  seoStrategyIntentDemand,
  seoStrategyMissingDemand,
  seoStrategyOpportunity,
  seoStrategyPayloadSchema,
  seoStrategyPlaceSchema,
  seoStrategyPurpose,
  seoStrategyPurposeSource,
} from "@/schemas/project-seo-strategy.schema";
import { publicSeoKeywordReach } from "./project-seo-keyword-reach";

import { auditedSeoPageKey } from "./project-seo-site-findings";

const count = z.number().finite().nullable();
/** The fields Core reads from a site report. Zod drops every other field of the strategy block. */
const source = z.object({
  selection: z
    .object({
      pages: z.array(z.object({ n: z.number().int(), url: seoUrlSchema })),
    })
    .optional(),
  strategy: z.object({
    purpose: seoStrategyPurpose.optional().catch(undefined),
    purposeSource: seoStrategyPurposeSource.optional().catch(undefined),
    demandByIntent: seoStrategyIntentDemand.optional().catch(undefined),
    missingDemandByIntent: seoStrategyMissingDemand.optional().catch(undefined),
    purposeOpportunity: seoStrategyOpportunity
      .omit({ pageUrl: true })
      .extend({ page: z.number().int().positive() })
      .optional()
      .catch(undefined),
    verdict: z.string(),
    why: z.string(),
    groups: z.array(
      z.object({
        lead: z.string(),
        keywords: z.array(z.string()),
        page: z.number().int().optional(),
        volume: count,
        recent: count,
        trend: z.enum(["falling", "rising", "flat"]).nullable(),
        reach: z.string(),
        position: count,
        forums: z.boolean().optional().catch(undefined),
        forumQuestions: importedSeoForumQuestions.optional().catch(undefined),
      }),
    ),
    actions: z
      .array(
        z.object({
          kind: z.string(),
          title: z.string(),
          why: z.string(),
          whatToExpect: z.string(),
          effort: z.enum(["low", "medium", "high"]),
          limit: z.string().nullable(),
          // Core kept neither field before, so a form it cannot read loses the field, not the strategy.
          place: z
            .object({ name: z.string(), url: z.string(), form: z.string() })
            .nullish()
            .catch(undefined),
          draft: z.string().nullish().catch(undefined),
          targets: z.array(
            z.object({
              url: z.string(),
              title: z.string().nullable(),
              type: z.string(),
              // Core kept no count before, so a count it cannot read loses the count, not the target.
              serps: z.number().int().nonnegative().nullish().catch(undefined),
              state: z.string().optional(),
            }),
          ),
        }),
      )
      .optional(),
    // Core kept no note before, so a form it cannot read loses the note, not the strategy.
    // The bot sends one entry per note; a Report from before joins them in `placesNote`.
    placesNotes: z.array(z.unknown()).nullish().catch(undefined),
    placesNote: z.string().nullish().catch(undefined),
  }),
});
/** A Report from before the list joins its place notes with this separator in one line. */
const PLACES_NOTE_SEPARATOR = "; ";
/**
 * A target or a place is a link in the workspace, so only a plain web address stays.
 * The check trims more than `new URL` does, so the checked value is the one to store.
 */
function webAddress(value: string): string | null {
  const checked = seoUrlSchema.safeParse(value);
  // The normalized address can be longer than the one that passed, so it is checked too.
  const url = checked.success
    ? seoUrlSchema.safeParse(new URL(checked.data).href)
    : checked;
  return url.success ? url.data : null;
}
/** The page number of the site's start page in a site report's page selection. */
const START_PAGE = 1;
export const SEO_STRATEGY_NOT_IMPORTED =
  "Strategy results not imported: Core cannot read the strategy section of this report";

/**
 * The strategy section of a site report. A report without one gives nothing.
 * A section Core cannot read gives a note, so the audit still imports.
 */
export function publicSeoStrategy(
  raw: unknown,
  auditedPageUrls: string[],
): {
  strategy?: SeoStrategyPayload;
  note?: string;
} {
  if (
    raw === null ||
    typeof raw !== "object" ||
    (raw as { strategy?: unknown }).strategy == null
  )
    return {};
  const parsed = source.safeParse(raw);
  if (!parsed.success) return { note: SEO_STRATEGY_NOT_IMPORTED };
  const selection = parsed.data.selection?.pages ?? [];
  const pages = new Map<number, string>();
  const audited = new Set(auditedPageUrls.map(auditedSeoPageKey));
  const verifiedPages = new Map<number, string>();
  for (const page of selection) {
    const canonical = auditedSeoPageKey(page.url);
    if (pages.has(page.n)) verifiedPages.delete(page.n);
    else if (audited.has(canonical)) verifiedPages.set(page.n, canonical);
    pages.set(page.n, page.url);
  }
  const {
    verdict,
    why,
    groups,
    actions = [],
    placesNotes: sentNotes,
    placesNote,
    purpose,
    purposeSource,
    purposeOpportunity: opportunity,
    demandByIntent,
    missingDemandByIntent,
  } = parsed.data.strategy;
  // One line per note; an entry that is no text, blank or longer than the payload allows is dropped, not the strategy.
  const lines = (notes: unknown[]) =>
    notes
      .filter((note): note is string => typeof note === "string")
      .map((line) => line.trim())
      .filter((line) => line && line.length <= SEO_STRATEGY_TEXT_MAX_LENGTH);
  const listed = lines(sentNotes ?? []);
  // A list with no note Core can keep hides no joined line.
  const placesNotes = (
    listed.length
      ? listed
      : lines((placesNote ?? "").split(PLACES_NOTE_SEPARATOR))
  ).slice(0, SEO_STRATEGY_PLACES_NOTES_MAX);
  const groupDemand = (group: (typeof groups)[number]) =>
    group.volume === null
      ? null
      : group.trend === "falling"
        ? group.recent
        : group.volume;
  const opportunityUrl = opportunity && verifiedPages.get(opportunity.page);
  const supportedOpportunity =
    opportunity &&
    opportunityUrl &&
    groups.some(
      (group) =>
        (group.page ?? START_PAGE) === opportunity.page &&
        group.lead === opportunity.keyword &&
        group.keywords.includes(opportunity.keyword) &&
        group.reach === opportunity.reach &&
        group.position !== 1 &&
        groupDemand(group) === opportunity.demand,
    );
  const auditedGroups = groups.every((group) =>
    verifiedPages.get(group.page ?? START_PAGE),
  );
  const measured = groups.map(groupDemand);
  const sumBuckets = (buckets: {
    buyer: number;
    informational: number;
    other: number;
  }) => buckets.buyer + buckets.informational + buckets.other;
  const knownTotal = measured.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  const missingTotal = measured.filter((value) => value === null).length;
  const strategy = seoStrategyPayloadSchema.safeParse({
    verdict,
    why,
    ...(purpose && { purpose }),
    ...(purpose && purposeSource && { purposeSource }),
    ...(purpose &&
      supportedOpportunity && {
        purposeOpportunity: {
          pageUrl: opportunityUrl,
          keyword: opportunity.keyword,
          demand: opportunity.demand,
          reach: opportunity.reach,
        },
      }),
    ...(auditedGroups &&
      demandByIntent &&
      sumBuckets(demandByIntent) === knownTotal && { demandByIntent }),
    ...(auditedGroups &&
      missingDemandByIntent &&
      sumBuckets(missingDemandByIntent) === missingTotal && {
        missingDemandByIntent,
      }),
    groups: groups.map(({ page, forums, forumQuestions, ...group }) => ({
      ...group,
      ...(forums !== undefined &&
        verifiedPages.get(page ?? START_PAGE) && { forums }),
      ...(forums &&
        forumQuestions?.length &&
        verifiedPages.has(page ?? START_PAGE) && { forumQuestions }),
      // The worker leaves the page number out when only the start page has keywords.
      pageUrl:
        verifiedPages.get(page ?? START_PAGE) ??
        pages.get(page ?? START_PAGE) ??
        null,
    })),
    actions: actions.map(
      ({ whatToExpect, targets, place, draft, ...action }) => {
        // The place is a link too. Without a plain web address the action stays and names no place.
        const placeUrl = place ? webAddress(place.url) : null;
        const checked =
          place && placeUrl
            ? seoStrategyPlaceSchema.safeParse({
                ...place,
                // A link needs text: a blank name shows the address.
                name: place.name.trim() || placeUrl,
                url: placeUrl,
              })
            : null;
        // The text is for the place, so it goes with the place. A blank text and one longer than the bot writes go too.
        const kept =
          checked?.success &&
          draft?.trim() &&
          draft.length <= SEO_STRATEGY_DRAFT_MAX_LENGTH;
        return {
          ...action,
          ...(checked?.success ? { place: checked.data } : {}),
          ...(kept ? { draft } : {}),
          expectedEffect: whatToExpect,
          targets: targets.flatMap((target) => {
            const url = webAddress(target.url);
            return url
              ? [
                  {
                    ...target,
                    url,
                    serps: target.serps ?? null,
                    state: target.state ?? null,
                  },
                ]
              : [];
          }),
        };
      },
    ),
    ...(placesNotes.length ? { placesNotes } : {}),
    ...publicSeoKeywordReach(raw as Record<string, unknown>, webAddress),
  });
  return strategy.success
    ? { strategy: strategy.data }
    : { note: SEO_STRATEGY_NOT_IMPORTED };
}
