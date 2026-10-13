import type {
  GoogleDisplayCampaignSpec,
  GoogleDisplayImage,
} from "@sokosumi/core-client";
import { GoogleDisplayCampaignSpecSchema } from "@sokosumi/core-client/schemas";
import * as z from "zod";
import {
  type GoogleCampaignMessages,
  type GoogleSharedFormValues,
  googleSharedFormShape,
  googleSpecShape,
  limitedText,
  refineGoogleCampaign,
  toGoogleSharedSpec,
} from "./google-campaign";
import {
  DISPLAY_IMAGE_MAX_BYTES,
  DISPLAY_IMAGE_MIME_TYPES,
  DISPLAY_IMAGE_ROLES,
  DISPLAY_IMAGE_RULES,
  displayImageCounts,
  missingDisplayImages,
} from "./google-display-images";

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
export interface GoogleDisplayMessages extends GoogleCampaignMessages {
  businessNameRequired: string;
  headlineRequired: string;
  headlineTooLong: string;
  longHeadlineRequired: string;
  descriptionRequired: string;
  descriptionTooLong: string;
  /** Said for the business name and the long headline over their limits. */
  tooLong: (max: number) => string;
  imagesMissing: (missing: "both" | "landscape" | "square") => string;
  imagesTooMany: (max: number) => string;
  logosTooMany: (max: number) => string;
  imageRepeated: string;
}

type OptionalMessages = Partial<GoogleDisplayMessages>;

const HEADLINES = GOOGLE_DISPLAY_LIMITS.headlines;
const DESCRIPTIONS = GOOGLE_DISPLAY_LIMITS.descriptions;

function businessName(messages: OptionalMessages) {
  return limitedText(
    GOOGLE_DISPLAY_LIMITS.businessName,
    messages.businessNameRequired,
    messages.tooLong?.(GOOGLE_DISPLAY_LIMITS.businessName),
  );
}

function headline(messages: OptionalMessages) {
  return limitedText(
    HEADLINES.length,
    messages.headlineRequired,
    messages.headlineTooLong,
  );
}

function longHeadline(messages: OptionalMessages) {
  return limitedText(
    GOOGLE_DISPLAY_LIMITS.longHeadline,
    messages.longHeadlineRequired,
    messages.tooLong?.(GOOGLE_DISPLAY_LIMITS.longHeadline),
  );
}

function description(messages: OptionalMessages) {
  return limitedText(
    DESCRIPTIONS.length,
    messages.descriptionRequired,
    messages.descriptionTooLong,
  );
}

const imageSchema = z.object({
  pathname: z.string().min(1),
  fileUrl: z.url(),
  name: z.string().min(1),
  size: z.int().min(1).max(DISPLAY_IMAGE_MAX_BYTES),
  mimeType: z.enum(DISPLAY_IMAGE_MIME_TYPES),
  role: z.enum(DISPLAY_IMAGE_ROLES),
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
  refineGoogleCampaign(value, headlines, ctx, messages);

  const { marketing, logo } = displayImageCounts(value.images);
  const issue = (message: string) =>
    ctx.addIssue({ code: "custom", path: ["images"], message });
  const missing = missingDisplayImages(value.images);
  if (missing) {
    // Form always passes translated messages. The server action re-check
    // without them keeps a machine code, never English product copy.
    issue(messages.imagesMissing?.(missing) ?? `images.missing.${missing}`);
  }
  if (marketing > DISPLAY_IMAGE_RULES.maxMarketing) {
    issue(
      messages.imagesTooMany?.(DISPLAY_IMAGE_RULES.maxMarketing) ??
        `images.tooMany.${DISPLAY_IMAGE_RULES.maxMarketing}`,
    );
  }
  if (logo > DISPLAY_IMAGE_RULES.maxLogos) {
    issue(
      messages.logosTooMany?.(DISPLAY_IMAGE_RULES.maxLogos) ??
        `images.logosTooMany.${DISPLAY_IMAGE_RULES.maxLogos}`,
    );
  }
  const paths = value.images.map(({ pathname }) => pathname);
  if (new Set(paths).size < paths.length) {
    issue(messages.imageRepeated ?? "images.repeated");
  }
}

/**
 * Core's Display spec as the server action receives it, so a call that skips
 * the form still meets Core's limits. Google stays the authority on image
 * dimensions and policy.
 */
export function googleDisplaySpecSchema(messages: OptionalMessages = {}) {
  return z
    .object({
      type: z.literal("DISPLAY"),
      ...googleSpecShape(messages),
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
      displayHeadlines: z
        .array(headline(messages))
        .min(HEADLINES.min)
        .max(HEADLINES.max),
      longHeadline: longHeadline(messages),
      displayDescriptions: z
        .array(description(messages))
        .min(DESCRIPTIONS.min)
        .max(DESCRIPTIONS.max),
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
    ...toGoogleSharedSpec(values),
    businessName: values.businessName.trim(),
    headlines: values.displayHeadlines.map((value) => value.trim()),
    longHeadline: values.longHeadline.trim(),
    descriptions: values.displayDescriptions.map((value) => value.trim()),
    images: values.images,
  };
}
