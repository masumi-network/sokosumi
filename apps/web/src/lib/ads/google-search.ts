import type { GoogleSearchCampaignSpec } from "@sokosumi/core-client";
import { GoogleSearchCampaignSpecSchema } from "@sokosumi/core-client/schemas";
import * as z from "zod";

import {
  GOOGLE_KEYWORD_LIMIT,
  GOOGLE_KEYWORD_MAX_LENGTH,
  GOOGLE_MATCH_TYPES,
  type GoogleKeywordIssue,
  parseGoogleKeywords,
} from "./google-keywords";

const spec = GoogleSearchCampaignSpecSchema.properties;

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
}

type Messages = Partial<GoogleSearchMessages>;

const HEADLINE_LIMITS = GOOGLE_SEARCH_LIMITS.headlines;
const DESCRIPTION_LIMITS = GOOGLE_SEARCH_LIMITS.descriptions;

const finalUrl = (m: Messages) =>
  z
    .string()
    .trim()
    .max(GOOGLE_SEARCH_LIMITS.finalUrl, m.finalUrl)
    .pipe(z.url({ protocol: /^https?$/, error: m.finalUrl }));

const headline = (m: Messages) =>
  z
    .string()
    .trim()
    .min(1, m.headlineRequired)
    .max(HEADLINE_LIMITS.length, m.headlineTooLong);

const description = (m: Messages) =>
  z
    .string()
    .trim()
    .min(1, m.descriptionRequired)
    .max(DESCRIPTION_LIMITS.length, m.descriptionTooLong);

/** The optional display path: empty or up to Core's length. */
const path = (m: Messages) =>
  z.string().trim().max(GOOGLE_SEARCH_LIMITS.path, m.pathTooLong);

/** Rules that span fields; absent values may be undefined or empty. */
function refineAcrossFields(
  value: {
    startDate?: string | undefined;
    endDate?: string | undefined;
    path1?: string | undefined;
    path2?: string | undefined;
    headlines: readonly string[];
  },
  ctx: z.RefinementCtx,
  m: Messages,
): void {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: m.endBeforeStart ?? "End date is before the start date",
    });
  }
  if (value.path2?.trim() && !value.path1?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["path2"],
      message: m.pathNeedsFirst ?? "Path 2 needs path 1",
    });
  }
  const seen = new Set<string>();
  value.headlines.forEach((text, index) => {
    const key = text.trim().toLowerCase();
    if (key !== "" && seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["headlines", index],
        message: m.headlineDuplicate ?? "Headlines must be different",
      });
    }
    seen.add(key);
  });
}

/**
 * Core's Search spec as the server action receives it, so a call that skips
 * the form still meets Core's limits. Google stays the authority on width
 * and policy.
 */
export function googleSearchSpecSchema(m: Messages = {}) {
  const id = z.string().regex(/^\d{1,20}$/);
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  return z
    .object({
      type: z.literal("SEARCH"),
      startDate: date.optional(),
      endDate: date.optional(),
      locationIds: z.array(id).max(GOOGLE_SEARCH_LIMITS.targetIds),
      languageIds: z.array(id).max(GOOGLE_SEARCH_LIMITS.targetIds),
      finalUrl: finalUrl(m),
      keywords: z
        .array(
          z.object({
            text: z.string().trim().min(1).max(GOOGLE_KEYWORD_MAX_LENGTH),
            matchType: z.enum(GOOGLE_MATCH_TYPES),
          }),
        )
        .min(1, m.keywordsRequired)
        .max(GOOGLE_KEYWORD_LIMIT, m.keywordsTooMany),
      headlines: z
        .array(headline(m))
        .min(HEADLINE_LIMITS.min)
        .max(HEADLINE_LIMITS.max),
      descriptions: z
        .array(description(m))
        .min(DESCRIPTION_LIMITS.min)
        .max(DESCRIPTION_LIMITS.max),
      path1: path(m).min(1).optional(),
      path2: path(m).min(1).optional(),
    })
    .superRefine((value, ctx) => refineAcrossFields(value, ctx, m));
}

/** What the Search part of the create page holds: text, as typed. */
export interface GoogleSearchFormValues {
  startDate: string;
  endDate: string;
  keywords: string;
  finalUrl: string;
  path1: string;
  path2: string;
  headlines: string[];
  descriptions: string[];
}

/** The same limits for the form's fields, in the reader's words. */
export function googleSearchFormSchema(m: Messages = {}) {
  return z
    .object({
      startDate: z.string(),
      endDate: z.string(),
      keywords: z.string().superRefine((value, ctx) => {
        const { keywords, invalid } = parseGoogleKeywords(value);
        const first = invalid[0];
        if (first) {
          ctx.addIssue({
            code: "custom",
            message:
              m.keywordsInvalid?.(first.line, first.issue) ??
              `Line ${first.line} is not a valid keyword`,
          });
        } else if (keywords.length === 0) {
          ctx.addIssue({ code: "custom", message: m.keywordsRequired });
        } else if (keywords.length > GOOGLE_KEYWORD_LIMIT) {
          ctx.addIssue({ code: "custom", message: m.keywordsTooMany });
        }
      }),
      finalUrl: finalUrl(m),
      path1: path(m),
      path2: path(m),
      headlines: z.array(headline(m)),
      descriptions: z.array(description(m)),
    })
    .superRefine((value, ctx) => refineAcrossFields(value, ctx, m));
}

/**
 * The Search spec for what the form holds. Targeting is empty until the
 * pickers exist, which Core reads as all countries and languages.
 */
export function toGoogleSearchSpec(
  values: GoogleSearchFormValues,
): GoogleSearchCampaignSpec {
  const path1 = values.path1.trim();
  const path2 = values.path2.trim();
  return {
    type: "SEARCH",
    ...(values.startDate ? { startDate: values.startDate } : {}),
    ...(values.endDate ? { endDate: values.endDate } : {}),
    locationIds: [],
    languageIds: [],
    finalUrl: values.finalUrl.trim(),
    keywords: parseGoogleKeywords(values.keywords).keywords,
    headlines: values.headlines.map((text) => text.trim()),
    descriptions: values.descriptions.map((text) => text.trim()),
    ...(path1 ? { path1 } : {}),
    ...(path1 && path2 ? { path2 } : {}),
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
