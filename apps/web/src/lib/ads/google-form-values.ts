import type { AdCampaignDetails } from "@sokosumi/core-client";

import {
  GOOGLE_DISPLAY_LIMITS,
  type GoogleDisplayFormValues,
} from "./google-display";
import {
  displayImageKey,
  type FormDisplayImage,
  isKeptImage,
} from "./google-display-images";
import { formatGoogleKeyword, parseGoogleKeywords } from "./google-keywords";
import {
  filledCallouts,
  filledSitelinks,
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchFormValues,
} from "./google-search";
import { toGoogleTarget } from "./targeting";

/** Everything a Google campaign form holds: both types' fields, one shown. */
export interface GoogleFormValues
  extends GoogleSearchFormValues,
    GoogleDisplayFormValues {
  type: "SEARCH" | "DISPLAY";
  name: string;
  dailyBudget: string;
}

function blankTexts(count: number): string[] {
  return Array.from({ length: count }, () => "");
}

/** What a new Google campaign starts with. */
export const EMPTY_GOOGLE_VALUES: GoogleFormValues = {
  type: "SEARCH",
  name: "",
  dailyBudget: "",
  startDate: "",
  endDate: "",
  locations: [],
  languages: [],
  finalUrl: "",
  keywords: "",
  path1: "",
  path2: "",
  headlines: blankTexts(GOOGLE_SEARCH_LIMITS.headlines.min),
  descriptions: blankTexts(GOOGLE_SEARCH_LIMITS.descriptions.min),
  sitelinks: [],
  callouts: [],
  businessName: "",
  displayHeadlines: blankTexts(GOOGLE_DISPLAY_LIMITS.headlines.min),
  longHeadline: "",
  displayDescriptions: blankTexts(GOOGLE_DISPLAY_LIMITS.descriptions.min),
  images: [],
};

/**
 * The edit form's start: what the campaign has now, as the create form holds
 * it. Keywords are one line each in Google's syntax; the ad's images are kept
 * ones; the other type's fields stay empty.
 */
export function googleFormValuesFromDetails({
  campaign,
  targeting,
  keywords,
  ad,
  sitelinks,
  callouts,
}: AdCampaignDetails): GoogleFormValues {
  const search = ad?.search;
  const display = ad?.display;
  return {
    ...EMPTY_GOOGLE_VALUES,
    type: campaign.type === "DISPLAY" ? "DISPLAY" : "SEARCH",
    name: campaign.name,
    dailyBudget: String(campaign.dailyBudget),
    startDate: campaign.startDate ?? "",
    endDate: campaign.endDate ?? "",
    locations: targeting.locations.map(toGoogleTarget),
    languages: targeting.languages.map(({ id, name }) => ({ id, name })),
    finalUrl: ad?.finalUrl ?? "",
    keywords: keywords.map(formatGoogleKeyword).join("\n"),
    path1: search?.path1 ?? "",
    path2: search?.path2 ?? "",
    headlines: search?.headlines ?? EMPTY_GOOGLE_VALUES.headlines,
    descriptions: search?.descriptions ?? EMPTY_GOOGLE_VALUES.descriptions,
    sitelinks: sitelinks.map(
      ({ text, finalUrl, description1, description2 }) => ({
        text,
        finalUrl,
        description1: description1 ?? "",
        description2: description2 ?? "",
      }),
    ),
    callouts: callouts.map(({ text }) => text),
    businessName: display?.businessName ?? "",
    displayHeadlines:
      display?.headlines ?? EMPTY_GOOGLE_VALUES.displayHeadlines,
    longHeadline: display?.longHeadline ?? "",
    displayDescriptions:
      display?.descriptions ?? EMPTY_GOOGLE_VALUES.displayDescriptions,
    images: (display?.images ?? []).map(({ assetId, role, url }) => ({
      assetId,
      role,
      url,
    })),
  };
}

/** The parts of a campaign the edit review names, one row each, in order. */
export const GOOGLE_FORM_CHANGES = [
  "name",
  "dailyBudget",
  "schedule",
  "locations",
  "languages",
  "keywords",
  "finalUrl",
  "path",
  "businessName",
  "headlines",
  "longHeadline",
  "descriptions",
  "sitelinks",
  "callouts",
  "images",
] as const;
export type GoogleFormChange = (typeof GOOGLE_FORM_CHANGES)[number];

/** An ad image as the review shows it; `key` tells it apart. */
export interface GoogleFormImage {
  key: string;
  role: FormDisplayImage["role"];
  url: string;
  /** A new file's name; a kept image has none. */
  name?: string;
}

/**
 * What each part means, not how it is typed: trimmed text, a budget as a
 * number, lists as sorted sets with blank rows left out. A part the type does
 * not have is empty. Lists are what the review compares item by item.
 */
export interface GoogleFormMeaning {
  name: string;
  dailyBudget: number;
  schedule: [string, string];
  locations: string[];
  languages: string[];
  keywords: string[];
  finalUrl: string;
  /** "shoes/sale": the display path after the domain. */
  path: string;
  businessName: string;
  headlines: string[];
  longHeadline: string;
  descriptions: string[];
  /** "Sale · https://example.com/sale · Up to 50% off" */
  sitelinks: string[];
  callouts: string[];
  images: GoogleFormImage[];
}

function filledTexts(texts: readonly string[]): string[] {
  return texts
    .map((text) => text.trim())
    .filter(Boolean)
    .sort();
}

export function googleFormMeaning(values: GoogleFormValues): GoogleFormMeaning {
  const ids = (targets: readonly { id: string }[]) =>
    targets.map(({ id }) => id).sort();
  const search = values.type === "SEARCH";
  const path1 = values.path1.trim();
  const path2 = values.path2.trim();
  return {
    name: values.name.trim(),
    dailyBudget: Number(values.dailyBudget),
    schedule: [values.startDate, values.endDate],
    locations: ids(values.locations),
    languages: ids(values.languages),
    keywords: search
      ? parseGoogleKeywords(values.keywords)
          .keywords.map(formatGoogleKeyword)
          .sort()
      : [],
    finalUrl: values.finalUrl.trim(),
    path: search && path1 ? [path1, path2].filter(Boolean).join("/") : "",
    businessName: search ? "" : values.businessName.trim(),
    headlines: filledTexts(search ? values.headlines : values.displayHeadlines),
    longHeadline: search ? "" : values.longHeadline.trim(),
    descriptions: filledTexts(
      search ? values.descriptions : values.displayDescriptions,
    ),
    sitelinks: search
      ? filledSitelinks(values.sitelinks)
          .map(({ text, finalUrl, description1, description2 }) =>
            [text, finalUrl, description1, description2]
              .filter(Boolean)
              .join(" · "),
          )
          .sort()
      : [],
    callouts: search ? filledCallouts(values.callouts).sort() : [],
    images: search
      ? []
      : values.images
          .map((image) => ({
            key: `${image.role}:${displayImageKey(image)}`,
            role: image.role,
            ...(isKeptImage(image)
              ? { url: image.url }
              : { url: image.fileUrl, name: image.name }),
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** The parts an edit changes, in review order; none when it means the same. */
export function googleFormChanges(
  before: GoogleFormValues,
  after: GoogleFormValues,
): GoogleFormChange[] {
  const was = googleFormMeaning(before);
  const now = googleFormMeaning(after);
  return GOOGLE_FORM_CHANGES.filter(
    (part) => JSON.stringify(was[part]) !== JSON.stringify(now[part]),
  );
}

/**
 * What a list edit removed and added, item by item: a replaced item is one of
 * each, a repeated item counts once per copy.
 */
export function googleListChanges<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string = String,
): { removed: T[]; added: T[] } {
  const missing = (items: readonly T[], others: readonly T[]) => {
    const left = new Map<string, number>();
    for (const other of others) {
      left.set(key(other), (left.get(key(other)) ?? 0) + 1);
    }
    return items.filter((item) => {
      const count = left.get(key(item)) ?? 0;
      left.set(key(item), count - 1);
      return count <= 0;
    });
  };
  return { removed: missing(before, after), added: missing(after, before) };
}
