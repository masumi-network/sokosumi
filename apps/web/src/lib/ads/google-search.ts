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
  forEachDuplicate,
  type GoogleCampaignMessages,
  type GoogleSharedFormValues,
  googleSharedFormShape,
  googleSpecShape,
  httpUrl,
  limitedText,
  refineGoogleCampaign,
  toGoogleSharedSpec,
} from "./google-campaign";
import {
  GOOGLE_KEYWORD_LIMIT,
  GOOGLE_KEYWORD_MAX_LENGTH,
  GOOGLE_KEYWORD_MAX_WORDS,
  GOOGLE_MATCH_TYPES,
  type GoogleKeywordIssue,
  parseGoogleKeywords,
} from "./google-keywords";

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
export interface GoogleSearchMessages extends GoogleCampaignMessages {
  headlineRequired: string;
  headlineTooLong: string;
  descriptionRequired: string;
  descriptionTooLong: string;
  /** Said for any text over its limit (path, sitelinks, callouts). */
  tooLong: (max: number) => string;
  pathNeedsFirst: string;
  keywordsRequired: string;
  keywordsTooMany: string;
  keywordsInvalid: (line: number, issue: GoogleKeywordIssue) => string;
  sitelinkTextRequired: string;
  sitelinkDescriptionsPair: string;
  sitelinkDuplicate: string;
  calloutDuplicate: string;
}

type OptionalMessages = Partial<GoogleSearchMessages>;

const HEADLINE_LIMITS = GOOGLE_SEARCH_LIMITS.headlines;
const DESCRIPTION_LIMITS = GOOGLE_SEARCH_LIMITS.descriptions;

export const SITELINK_LIMITS = GOOGLE_SEARCH_LIMITS.sitelinks;
const CALLOUT_LIMITS = GOOGLE_SEARCH_LIMITS.callouts;

function headline(messages: OptionalMessages) {
  return limitedText(
    HEADLINE_LIMITS.length,
    messages.headlineRequired,
    messages.headlineTooLong,
  );
}

function description(messages: OptionalMessages) {
  return limitedText(
    DESCRIPTION_LIMITS.length,
    messages.descriptionRequired,
    messages.descriptionTooLong,
  );
}

function tooLong(messages: OptionalMessages, max: number) {
  return messages.tooLong?.(max);
}

function sitelinkDescription(messages: OptionalMessages) {
  return z
    .string()
    .trim()
    .min(1)
    .max(
      SITELINK_LIMITS.description,
      tooLong(messages, SITELINK_LIMITS.description),
    )
    .optional();
}

/** One sitelink as Core takes it: both description lines or neither. */
function sitelinkSchema(messages: OptionalMessages) {
  return z
    .object({
      text: z
        .string()
        .trim()
        .min(1, messages.sitelinkTextRequired)
        .max(SITELINK_LIMITS.text, tooLong(messages, SITELINK_LIMITS.text)),
      finalUrl: httpUrl(SITELINK_LIMITS.url, messages.finalUrl),
      description1: sitelinkDescription(messages),
      description2: sitelinkDescription(messages),
    })
    .superRefine((value, ctx) => {
      if (!value.description1 !== !value.description2) {
        ctx.addIssue({
          code: "custom",
          path: [value.description1 ? "description2" : "description1"],
          // Form always passes translated messages. Spec path without them
          // keeps a machine code, never English product copy.
          message:
            messages.sitelinkDescriptionsPair ?? "sitelinks.descriptionsPair",
        });
      }
    });
}

function callout(messages: OptionalMessages) {
  return z
    .string()
    .trim()
    .max(CALLOUT_LIMITS.length, tooLong(messages, CALLOUT_LIMITS.length));
}

/** The optional display path: empty or up to Core's length. */
function path(messages: OptionalMessages) {
  return z
    .string()
    .trim()
    .max(
      GOOGLE_SEARCH_LIMITS.path,
      tooLong(messages, GOOGLE_SEARCH_LIMITS.path),
    );
}

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
  refineGoogleCampaign(
    value,
    { path: "headlines", texts: value.headlines },
    ctx,
    messages,
  );
  if (value.path2?.trim() && !value.path1?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["path2"],
      message: messages.pathNeedsFirst ?? "Path 2 needs path 1",
    });
  }
  forEachDuplicate(
    (value.sitelinks ?? []).map(({ text }) => text),
    (index) =>
      ctx.addIssue({
        code: "custom",
        path: ["sitelinks", index, "text"],
        message: messages.sitelinkDuplicate ?? "sitelinks.duplicate",
      }),
  );
  forEachDuplicate(value.callouts ?? [], (index) =>
    ctx.addIssue({
      code: "custom",
      path: ["callouts", index],
      message: messages.calloutDuplicate ?? "callouts.duplicate",
    }),
  );
}

/**
 * Core's Search spec as the server action receives it, so a call that skips
 * the form still meets Core's limits. Google stays the authority on width
 * and policy.
 */
export function googleSearchSpecSchema(messages: OptionalMessages = {}) {
  return z
    .object({
      type: z.literal("SEARCH"),
      ...googleSpecShape(messages),
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

/** The fields of a sitelink as typed, whatever is in them. */
const sitelinkRow = z.object({
  text: z.string(),
  finalUrl: z.string(),
  description1: z.string(),
  description2: z.string(),
});

/** A sitelink as typed; a row with nothing in it is not sent. */
export type SitelinkFormValues = z.infer<typeof sitelinkRow>;

export const EMPTY_SITELINK: SitelinkFormValues = {
  text: "",
  finalUrl: "",
  description1: "",
  description2: "",
};

function isBlankSitelink(row: SitelinkFormValues): boolean {
  return Object.values(row).every((text) => text.trim() === "");
}

function toSitelink(row: SitelinkFormValues): GoogleSitelink {
  return {
    text: row.text.trim(),
    finalUrl: row.finalUrl.trim(),
    ...(row.description1.trim()
      ? { description1: row.description1.trim() }
      : {}),
    ...(row.description2.trim()
      ? { description2: row.description2.trim() }
      : {}),
  };
}

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

/** The same limits for the form's fields, in the reader's words. */
export function googleSearchFormSchema(messages: OptionalMessages = {}) {
  const sitelinkRules = sitelinkSchema(messages);
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
          sitelinkRow.superRefine((row, ctx) => {
            if (isBlankSitelink(row)) return;
            // Core's rules for a row with something in it; a blank row is skipped.
            const result = sitelinkRules.safeParse(toSitelink(row));
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

/** The Search spec for what the form holds. */
export function toGoogleSearchSpec(
  values: GoogleSearchFormValues,
): GoogleSearchCampaignSpec {
  const path1 = values.path1.trim();
  const path2 = values.path2.trim();
  const sitelinks = filledSitelinks(values.sitelinks);
  const callouts = filledCallouts(values.callouts);
  return {
    type: "SEARCH",
    ...toGoogleSharedSpec(values),
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
