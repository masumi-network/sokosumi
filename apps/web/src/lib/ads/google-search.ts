import type {
  GoogleSearchCampaignSpec,
  GoogleSitelink,
} from "@sokosumi/core-client";
import {
  GoogleSearchCampaignSpecSchema,
  GoogleSitelinkSchema,
} from "@sokosumi/core-client/schemas";
import * as z from "zod";

import {
  GOOGLE_KEYWORD_LIMIT,
  GOOGLE_KEYWORD_MAX_LENGTH,
  GOOGLE_KEYWORD_MAX_WORDS,
  GOOGLE_MATCH_TYPES,
  type GoogleKeywordIssue,
  parseGoogleKeywords,
} from "./google-keywords";
import type { GoogleTarget } from "./targeting";

const spec = GoogleSearchCampaignSpecSchema.properties;
const sitelink = GoogleSitelinkSchema.properties;

/** Core's limits for a Search campaign's ad, from its API schema. */
export const GOOGLE_SEARCH_LIMITS = {
  headlines: {
    min: spec.headlines.minItems,
    max: spec.headlines.maxItems,
    length: spec.headlines.items.maxLength,
  },
  descriptions: {
    min: spec.descriptions.minItems,
    max: spec.descriptions.maxItems,
    length: spec.descriptions.items.maxLength,
  },
  path: spec.path1.maxLength,
  finalUrl: spec.finalUrl.maxLength,
  targetIds: spec.locationIds.maxItems,
  sitelinks: {
    max: spec.sitelinks.maxItems,
    text: sitelink.text.maxLength,
    url: sitelink.finalUrl.maxLength,
    description: sitelink.description1.maxLength,
  },
  callouts: {
    min: spec.callouts.minItems,
    max: spec.callouts.maxItems,
    length: spec.callouts.items.maxLength,
  },
} as const;

/** What a refusal says. Without them (the server action) zod's defaults do. */
export interface GoogleSearchMessages {
  finalUrl: string;
  headlineRequired: string;
  headlineTooLong: string;
  headlineDuplicate: string;
  descriptionRequired: string;
  descriptionTooLong: string;
  pathTooLong: string;
  pathNeedsFirst: string;
  endBeforeStart: string;
  keywordsRequired: string;
  keywordsTooMany: string;
  keywordsInvalid: (line: number, issue: GoogleKeywordIssue) => string;
  sitelinkTextRequired: string;
  sitelinkTextTooLong: string;
  sitelinkDescriptionTooLong: string;
  sitelinkDescriptionsPair: string;
  sitelinkDuplicate: string;
  calloutTooLong: string;
  calloutDuplicate: string;
}

type OptionalMessages = Partial<GoogleSearchMessages>;

const HEADLINE_LIMITS = GOOGLE_SEARCH_LIMITS.headlines;
const DESCRIPTION_LIMITS = GOOGLE_SEARCH_LIMITS.descriptions;

const SITELINK_LIMITS = GOOGLE_SEARCH_LIMITS.sitelinks;
const CALLOUT_LIMITS = GOOGLE_SEARCH_LIMITS.callouts;

const httpUrl = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .pipe(z.url({ protocol: /^https?$/, error: message }));

export const googleFinalUrl = (messages: { finalUrl?: string }) =>
  httpUrl(GOOGLE_SEARCH_LIMITS.finalUrl, messages.finalUrl);

const headline = (messages: OptionalMessages) =>
  z
    .string()
    .trim()
    .min(1, messages.headlineRequired)
    .max(HEADLINE_LIMITS.length, messages.headlineTooLong);

const description = (messages: OptionalMessages) =>
  z
    .string()
    .trim()
    .min(1, messages.descriptionRequired)
    .max(DESCRIPTION_LIMITS.length, messages.descriptionTooLong);

/** One sitelink as Core takes it: both description lines or neither. */
const sitelinkSchema = (messages: OptionalMessages) =>
  z
    .object({
      text: z
        .string()
        .trim()
        .min(1, messages.sitelinkTextRequired)
        .max(SITELINK_LIMITS.text, messages.sitelinkTextTooLong),
      finalUrl: httpUrl(SITELINK_LIMITS.url, messages.finalUrl),
      description1: z
        .string()
        .trim()
        .min(1)
        .max(SITELINK_LIMITS.description, messages.sitelinkDescriptionTooLong)
        .optional(),
      description2: z
        .string()
        .trim()
        .min(1)
        .max(SITELINK_LIMITS.description, messages.sitelinkDescriptionTooLong)
        .optional(),
    })
    .superRefine((value, ctx) => {
      if (!value.description1 !== !value.description2) {
        ctx.addIssue({
          code: "custom",
          path: [value.description1 ? "description2" : "description1"],
          message:
            messages.sitelinkDescriptionsPair ??
            "Add both description lines or neither",
        });
      }
    });

const callout = (messages: OptionalMessages) =>
  z.string().trim().max(CALLOUT_LIMITS.length, messages.calloutTooLong);

/** The optional display path: empty or up to Core's length. */
const path = (messages: OptionalMessages) =>
  z.string().trim().max(GOOGLE_SEARCH_LIMITS.path, messages.pathTooLong);

/** Rules that span fields; absent values may be undefined or empty. */
function refineAcrossFields(
  value: {
    startDate?: string | undefined;
    endDate?: string | undefined;
    path1?: string | undefined;
    path2?: string | undefined;
    headlines: readonly string[];
    sitelinks?: readonly { text: string }[] | undefined;
    callouts?: readonly string[] | undefined;
  },
  ctx: z.RefinementCtx,
  messages: OptionalMessages,
): void {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: messages.endBeforeStart ?? "End date is before the start date",
    });
  }
  if (value.path2?.trim() && !value.path1?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["path2"],
      message: messages.pathNeedsFirst ?? "Path 2 needs path 1",
    });
  }
  forEachDuplicate(value.headlines, (index) =>
    ctx.addIssue({
      code: "custom",
      path: ["headlines", index],
      message: messages.headlineDuplicate ?? "Headlines must be different",
    }),
  );
  forEachDuplicate(
    (value.sitelinks ?? []).map(({ text }) => text),
    (index) =>
      ctx.addIssue({
        code: "custom",
        path: ["sitelinks", index, "text"],
        message: messages.sitelinkDuplicate ?? "Sitelinks must be different",
      }),
  );
  forEachDuplicate(value.callouts ?? [], (index) =>
    ctx.addIssue({
      code: "custom",
      path: ["callouts", index],
      message: messages.calloutDuplicate ?? "Callouts must be different",
    }),
  );
}

/** Calls `report` with the index of each text that repeats an earlier one, ignoring case. */
export function forEachDuplicate(
  texts: readonly string[],
  report: (index: number) => void,
): void {
  const seen = new Set<string>();
  texts.forEach((text, index) => {
    const key = text.trim().toLowerCase();
    if (key !== "" && seen.has(key)) report(index);
    seen.add(key);
  });
}

/** Whether `YYYY-MM-DD` is a real day: 2026-02-31 is not. */
export function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Core's Search spec as the server action receives it, so a call that skips
 * the form still meets Core's limits. Google stays the authority on width
 * and policy.
 */
export function googleSearchSpecSchema(messages: OptionalMessages = {}) {
  const id = z.string().regex(/^\d{1,20}$/);
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isCalendarDate);
  return z
    .object({
      type: z.literal("SEARCH"),
      startDate: date.optional(),
      endDate: date.optional(),
      locationIds: z.array(id).max(GOOGLE_SEARCH_LIMITS.targetIds),
      languageIds: z.array(id).max(GOOGLE_SEARCH_LIMITS.targetIds),
      finalUrl: googleFinalUrl(messages),
      keywords: z
        .array(
          z.object({
            text: z
              .string()
              .trim()
              .min(1)
              .max(GOOGLE_KEYWORD_MAX_LENGTH)
              .refine(
                (text) => text.split(/\s+/).length <= GOOGLE_KEYWORD_MAX_WORDS,
              ),
            matchType: z.enum(GOOGLE_MATCH_TYPES),
          }),
        )
        .min(1, messages.keywordsRequired)
        .max(GOOGLE_KEYWORD_LIMIT, messages.keywordsTooMany),
      headlines: z
        .array(headline(messages))
        .min(HEADLINE_LIMITS.min)
        .max(HEADLINE_LIMITS.max),
      descriptions: z
        .array(description(messages))
        .min(DESCRIPTION_LIMITS.min)
        .max(DESCRIPTION_LIMITS.max),
      path1: path(messages).min(1).optional(),
      path2: path(messages).min(1).optional(),
      sitelinks: z
        .array(sitelinkSchema(messages))
        .max(SITELINK_LIMITS.max)
        .optional(),
      callouts: z
        .array(callout(messages).min(1))
        .max(CALLOUT_LIMITS.max)
        .optional(),
    })
    .superRefine((value, ctx) => refineAcrossFields(value, ctx, messages));
}

/** What every Google campaign's part of the create page holds, as typed. */
export interface GoogleSharedFormValues {
  startDate: string;
  endDate: string;
  locations: GoogleTarget[];
  languages: GoogleTarget[];
  finalUrl: string;
}

/** What the Search part of the create page holds: text, as typed. */
export interface GoogleSearchFormValues extends GoogleSharedFormValues {
  keywords: string;
  path1: string;
  path2: string;
  headlines: string[];
  descriptions: string[];
  sitelinks: SitelinkFormValues[];
  callouts: string[];
}

/** A sitelink as typed; a row with nothing in it is not sent. */
export interface SitelinkFormValues {
  text: string;
  finalUrl: string;
  description1: string;
  description2: string;
}

const isBlankSitelink = (row: SitelinkFormValues): boolean =>
  Object.values(row).every((text) => text.trim() === "");

const toSitelink = (row: SitelinkFormValues): GoogleSitelink => ({
  text: row.text.trim(),
  finalUrl: row.finalUrl.trim(),
  ...(row.description1.trim() ? { description1: row.description1.trim() } : {}),
  ...(row.description2.trim() ? { description2: row.description2.trim() } : {}),
});

/** The sitelinks the form would send: the rows with something in them. */
export function filledSitelinks(
  rows: readonly SitelinkFormValues[],
): GoogleSitelink[] {
  return rows.filter((row) => !isBlankSitelink(row)).map(toSitelink);
}

/** The callouts the form would send: the texts with something in them. */
export function filledCallouts(texts: readonly string[]): string[] {
  return texts.map((text) => text.trim()).filter(Boolean);
}

/** The form's fields every Google campaign has, whatever its type. */
export function googleSharedFormShape(messages: { finalUrl?: string } = {}) {
  const targets = z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        detail: z.string().optional(),
      }),
    )
    .max(GOOGLE_SEARCH_LIMITS.targetIds);
  return {
    startDate: z.string(),
    endDate: z.string(),
    locations: targets,
    languages: targets,
    finalUrl: googleFinalUrl(messages),
  };
}

/** The same limits for the form's fields, in the reader's words. */
export function googleSearchFormSchema(messages: OptionalMessages = {}) {
  return z
    .object({
      ...googleSharedFormShape(messages),
      keywords: z.string().superRefine((value, ctx) => {
        const { keywords, invalid } = parseGoogleKeywords(value);
        const first = invalid[0];
        if (first) {
          ctx.addIssue({
            code: "custom",
            message:
              messages.keywordsInvalid?.(first.line, first.issue) ??
              `Line ${first.line} is not a valid keyword`,
          });
        } else if (keywords.length === 0) {
          ctx.addIssue({ code: "custom", message: messages.keywordsRequired });
        } else if (keywords.length > GOOGLE_KEYWORD_LIMIT) {
          ctx.addIssue({ code: "custom", message: messages.keywordsTooMany });
        }
      }),
      path1: path(messages),
      path2: path(messages),
      headlines: z.array(headline(messages)),
      descriptions: z.array(description(messages)),
      sitelinks: z
        .array(
          z
            .object({
              text: z.string(),
              finalUrl: z.string(),
              description1: z.string(),
              description2: z.string(),
            })
            .superRefine((row, ctx) => {
              if (isBlankSitelink(row)) return;
              // Core's rules for a row with something in it; a blank row is skipped.
              const result = sitelinkSchema(messages).safeParse(
                toSitelink(row),
              );
              for (const { path, message } of result.error?.issues ?? []) {
                ctx.addIssue({ code: "custom", path, message });
              }
            }),
        )
        .max(SITELINK_LIMITS.max),
      callouts: z.array(callout(messages)).max(CALLOUT_LIMITS.max),
    })
    .superRefine((value, ctx) => refineAcrossFields(value, ctx, messages));
}

/**
 * The Search spec for what the form holds. No locations or languages is all of
 * them, which is how Core reads empty lists.
 */
export function toGoogleSearchSpec(
  values: GoogleSearchFormValues,
): GoogleSearchCampaignSpec {
  const path1 = values.path1.trim();
  const path2 = values.path2.trim();
  const sitelinks = filledSitelinks(values.sitelinks);
  const callouts = filledCallouts(values.callouts);
  return {
    type: "SEARCH",
    ...(values.startDate ? { startDate: values.startDate } : {}),
    ...(values.endDate ? { endDate: values.endDate } : {}),
    locationIds: values.locations.map(({ id }) => id),
    languageIds: values.languages.map(({ id }) => id),
    finalUrl: values.finalUrl.trim(),
    keywords: parseGoogleKeywords(values.keywords).keywords,
    headlines: values.headlines.map((text) => text.trim()),
    descriptions: values.descriptions.map((text) => text.trim()),
    ...(path1 ? { path1 } : {}),
    ...(path1 && path2 ? { path2 } : {}),
    ...(sitelinks.length > 0 ? { sitelinks } : {}),
    ...(callouts.length > 0 ? { callouts } : {}),
  };
}

/**
 * The address as the ad shows it: the domain without `www.`, then up to two
 * display paths, `example.com/shoes/sale`. A path 2 without a path 1 is not
 * shown, as it is not sent. Before there is a valid final URL, `example.com`.
 */
export function adDisplayUrl(
  finalUrl: string,
  path1: string,
  path2: string,
): string {
  let domain = "example.com";
  try {
    domain = new URL(finalUrl.trim()).hostname.replace(/^www\./, "");
  } catch {
    // Still typing: the placeholder domain stands in.
  }
  const first = path1.trim();
  const second = first ? path2.trim() : "";
  return [domain, first, second].filter(Boolean).join("/");
}
