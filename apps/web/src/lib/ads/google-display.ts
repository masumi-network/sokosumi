import type {
  GoogleDisplayCampaignSpec,
  GoogleDisplayImage,
} from "@sokosumi/core-client";
import { GoogleDisplayCampaignSpecSchema } from "@sokosumi/core-client/schemas";
import * as z from "zod";

import {
  DISPLAY_IMAGE_MAX_BYTES,
  DISPLAY_IMAGE_MIME_TYPES,
  DISPLAY_IMAGE_RULES,
  displayImageCounts,
  missingDisplayImages,
} from "./google-display-images";
import {
  forEachDuplicate,
  GOOGLE_SEARCH_LIMITS,
  type GoogleSharedFormValues,
  googleFinalUrl,
  googleSharedFormShape,
  isCalendarDate,
} from "./google-search";

const spec = GoogleDisplayCampaignSpecSchema.properties;

/** Core's limits for a Display campaign's ad, from its API schema. */
export const GOOGLE_DISPLAY_LIMITS = {
  businessName: spec.businessName.maxLength,
  headlines: {
    min: spec.headlines.minItems,
    max: spec.headlines.maxItems,
    length: spec.headlines.items.maxLength,
  },
  longHeadline: spec.longHeadline.maxLength,
  descriptions: {
    min: spec.descriptions.minItems,
    max: spec.descriptions.maxItems,
    length: spec.descriptions.items.maxLength,
  },
  images: spec.images.maxItems,
} as const;

/** What a refusal says. Without them (the server action) zod's defaults do. */
export interface GoogleDisplayMessages {
  finalUrl: string;
  businessNameRequired: string;
  headlineRequired: string;
  headlineTooLong: string;
  headlineDuplicate: string;
  longHeadlineRequired: string;
  descriptionRequired: string;
  descriptionTooLong: string;
  /** Said for the business name and the long headline over their limits. */
  tooLong: (max: number) => string;
  endBeforeStart: string;
  imagesMissing: (missing: "both" | "landscape" | "square") => string;
}

type OptionalMessages = Partial<GoogleDisplayMessages>;

const HEADLINES = GOOGLE_DISPLAY_LIMITS.headlines;
const DESCRIPTIONS = GOOGLE_DISPLAY_LIMITS.descriptions;

const text = (max: number, required?: string, tooLong?: string) =>
  z.string().trim().min(1, required).max(max, tooLong);

const businessName = (m: OptionalMessages) =>
  text(
    GOOGLE_DISPLAY_LIMITS.businessName,
    m.businessNameRequired,
    m.tooLong?.(GOOGLE_DISPLAY_LIMITS.businessName),
  );
const headline = (m: OptionalMessages) =>
  text(HEADLINES.length, m.headlineRequired, m.headlineTooLong);
const longHeadline = (m: OptionalMessages) =>
  text(
    GOOGLE_DISPLAY_LIMITS.longHeadline,
    m.longHeadlineRequired,
    m.tooLong?.(GOOGLE_DISPLAY_LIMITS.longHeadline),
  );
const description = (m: OptionalMessages) =>
  text(DESCRIPTIONS.length, m.descriptionRequired, m.descriptionTooLong);

const imageSchema = z.object({
  pathname: z.string().min(1),
  fileUrl: z.url(),
  name: z.string().min(1),
  size: z.int().min(1).max(DISPLAY_IMAGE_MAX_BYTES),
  mimeType: z.enum(DISPLAY_IMAGE_MIME_TYPES),
  role: z.enum(["LANDSCAPE", "SQUARE", "LOGO"]),
});

/** Rules that span fields, as Core states them. */
function refineAcrossFields(
  value: {
    startDate?: string | undefined;
    endDate?: string | undefined;
    images: readonly GoogleDisplayImage[];
  },
  headlines: { path: string; texts: readonly string[] },
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
  forEachDuplicate(headlines.texts, (index) =>
    ctx.addIssue({
      code: "custom",
      path: [headlines.path, index],
      message: messages.headlineDuplicate ?? "Headlines must be different",
    }),
  );

  const { marketing, logo } = displayImageCounts(value.images);
  const issue = (message: string) =>
    ctx.addIssue({ code: "custom", path: ["images"], message });
  const missing = missingDisplayImages(value.images);
  if (missing) {
    issue(
      messages.imagesMissing?.(missing) ??
        "Add at least one landscape and one square image",
    );
  }
  if (marketing > DISPLAY_IMAGE_RULES.maxMarketing) {
    issue(`Use at most ${DISPLAY_IMAGE_RULES.maxMarketing} images`);
  }
  if (logo > DISPLAY_IMAGE_RULES.maxLogos) {
    issue(`Use at most ${DISPLAY_IMAGE_RULES.maxLogos} logos`);
  }
  const paths = value.images.map(({ pathname }) => pathname);
  if (new Set(paths).size < paths.length) issue("Use each image file once");
}

/**
 * Core's Display spec as the server action receives it, so a call that skips
 * the form still meets Core's limits. Google stays the authority on image
 * dimensions and policy.
 */
export function googleDisplaySpecSchema(messages: OptionalMessages = {}) {
  const id = z.string().regex(/^\d{1,20}$/);
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isCalendarDate);
  return z
    .object({
      type: z.literal("DISPLAY"),
      startDate: date.optional(),
      endDate: date.optional(),
      locationIds: z.array(id).max(GOOGLE_SEARCH_LIMITS.targetIds),
      languageIds: z.array(id).max(GOOGLE_SEARCH_LIMITS.targetIds),
      finalUrl: googleFinalUrl(messages),
      businessName: businessName(messages),
      headlines: z
        .array(headline(messages))
        .min(HEADLINES.min)
        .max(HEADLINES.max),
      longHeadline: longHeadline(messages),
      descriptions: z
        .array(description(messages))
        .min(DESCRIPTIONS.min)
        .max(DESCRIPTIONS.max),
      images: z.array(imageSchema).max(GOOGLE_DISPLAY_LIMITS.images),
    })
    .superRefine((value, ctx) =>
      refineAcrossFields(
        value,
        { path: "headlines", texts: value.headlines },
        ctx,
        messages,
      ),
    );
}

/**
 * What the Display part of the create page holds, as typed. Its headlines and
 * descriptions are its own, so switching type loses nobody's text.
 */
export interface GoogleDisplayFormValues extends GoogleSharedFormValues {
  businessName: string;
  displayHeadlines: string[];
  longHeadline: string;
  displayDescriptions: string[];
  /** Marketing images and logos together, told apart by their role. */
  images: GoogleDisplayImage[];
}

/** The same limits for the form's fields, in the reader's words. */
export function googleDisplayFormSchema(messages: OptionalMessages = {}) {
  return z
    .object({
      ...googleSharedFormShape(messages),
      businessName: businessName(messages),
      displayHeadlines: z.array(headline(messages)),
      longHeadline: longHeadline(messages),
      displayDescriptions: z.array(description(messages)),
      images: z.array(imageSchema),
    })
    .superRefine((value, ctx) =>
      refineAcrossFields(
        value,
        { path: "displayHeadlines", texts: value.displayHeadlines },
        ctx,
        messages,
      ),
    );
}

/** The Display spec for what the form holds. */
export function toGoogleDisplaySpec(
  values: GoogleDisplayFormValues,
): GoogleDisplayCampaignSpec {
  return {
    type: "DISPLAY",
    ...(values.startDate ? { startDate: values.startDate } : {}),
    ...(values.endDate ? { endDate: values.endDate } : {}),
    locationIds: values.locations.map(({ id }) => id),
    languageIds: values.languages.map(({ id }) => id),
    finalUrl: values.finalUrl.trim(),
    businessName: values.businessName.trim(),
    headlines: values.displayHeadlines.map((value) => value.trim()),
    longHeadline: values.longHeadline.trim(),
    descriptions: values.displayDescriptions.map((value) => value.trim()),
    images: values.images,
  };
}
