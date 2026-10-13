import { GoogleSearchCampaignSpecSchema } from "@sokosumi/core-client/schemas";
import * as z from "zod";

import type { GoogleTarget } from "./targeting";

const spec = GoogleSearchCampaignSpecSchema.properties;

/** Core's limits that every Google campaign type shares, from its API schema. */
export const GOOGLE_CAMPAIGN_LIMITS = {
  finalUrl: spec.finalUrl.maxLength,
  targetIds: spec.locationIds.maxItems,
} as const;

/** What a refusal says, for the rules every Google campaign type has. */
export interface GoogleCampaignMessages {
  finalUrl: string;
  headlineDuplicate: string;
  endBeforeStart: string;
}

type OptionalMessages = Partial<GoogleCampaignMessages>;

/** A trimmed text of one to `max` characters. */
export function limitedText(max: number, required?: string, tooLong?: string) {
  return z.string().trim().min(1, required).max(max, tooLong);
}

/** An `http` or `https` address of up to `max` characters. */
export function httpUrl(max: number, message?: string) {
  return z
    .string()
    .trim()
    .max(max, message)
    .pipe(z.url({ protocol: /^https?$/, error: message }));
}

export function googleFinalUrl(messages: OptionalMessages) {
  return httpUrl(GOOGLE_CAMPAIGN_LIMITS.finalUrl, messages.finalUrl);
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

/** The spec fields every Google campaign has, as Core takes them. */
export function googleSpecShape(messages: OptionalMessages) {
  const id = z.string().regex(/^\d{1,20}$/);
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isCalendarDate);
  return {
    startDate: date.optional(),
    endDate: date.optional(),
    locationIds: z.array(id).max(GOOGLE_CAMPAIGN_LIMITS.targetIds),
    languageIds: z.array(id).max(GOOGLE_CAMPAIGN_LIMITS.targetIds),
    finalUrl: googleFinalUrl(messages),
  };
}

/**
 * The rules every Google campaign has across fields: the end is not before
 * the start, and no two headlines are alike. `headlines.path` is where the
 * headlines sit in the value being checked. Absent dates may be undefined or
 * empty.
 */
export function refineGoogleCampaign(
  value: { startDate?: string | undefined; endDate?: string | undefined },
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
}

/** What every Google campaign's part of the create page holds, as typed. */
export interface GoogleSharedFormValues {
  startDate: string;
  endDate: string;
  locations: GoogleTarget[];
  languages: GoogleTarget[];
  finalUrl: string;
}

/** The form's fields every Google campaign has, whatever its type. */
export function googleSharedFormShape(messages: OptionalMessages = {}) {
  const targets = z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        detail: z.string().optional(),
      }),
    )
    .max(GOOGLE_CAMPAIGN_LIMITS.targetIds);
  return {
    startDate: z.string(),
    endDate: z.string(),
    locations: targets,
    languages: targets,
    finalUrl: googleFinalUrl(messages),
  };
}

/**
 * The spec fields every Google campaign has, for what the form holds. No
 * locations or languages is all of them, which is how Core reads empty lists.
 */
export function toGoogleSharedSpec(values: GoogleSharedFormValues): {
  startDate?: string;
  endDate?: string;
  locationIds: string[];
  languageIds: string[];
  finalUrl: string;
} {
  return {
    ...(values.startDate ? { startDate: values.startDate } : {}),
    ...(values.endDate ? { endDate: values.endDate } : {}),
    locationIds: values.locations.map(({ id }) => id),
    languageIds: values.languages.map(({ id }) => id),
    finalUrl: values.finalUrl.trim(),
  };
}
