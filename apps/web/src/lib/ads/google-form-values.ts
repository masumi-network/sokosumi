import type { AdCampaignDetails } from "@sokosumi/core-client";

import {
  GOOGLE_DISPLAY_LIMITS,
  type GoogleDisplayFormValues,
} from "./google-display";
import { displayImageKey } from "./google-display-images";
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

/** The parts of a campaign the edit review names, one row each. */
export const GOOGLE_FORM_CHANGES = [
  "name",
  "dailyBudget",
  "schedule",
  "locations",
  "languages",
  "keywords",
  "finalUrl",
  "ad",
] as const;
export type GoogleFormChange = (typeof GOOGLE_FORM_CHANGES)[number];

function filledTexts(texts: readonly string[]): string[] {
  return texts.map((text) => text.trim()).filter(Boolean);
}

/**
 * What each part means, not how it is typed: trimmed text, a budget as a
 * number, targets and keywords as sorted sets, blank ad rows left out.
 */
function meaning(values: GoogleFormValues): Record<GoogleFormChange, unknown> {
  const ids = (targets: readonly { id: string }[]) =>
    targets.map(({ id }) => id).sort();
  const search = values.type === "SEARCH";
  const path1 = values.path1.trim();
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
    ad: search
      ? {
          path1,
          path2: path1 ? values.path2.trim() : "",
          headlines: filledTexts(values.headlines),
          descriptions: filledTexts(values.descriptions),
          sitelinks: filledSitelinks(values.sitelinks),
          callouts: filledCallouts(values.callouts),
        }
      : {
          businessName: values.businessName.trim(),
          headlines: filledTexts(values.displayHeadlines),
          longHeadline: values.longHeadline.trim(),
          descriptions: filledTexts(values.displayDescriptions),
          images: values.images
            .map((image) => `${image.role}:${displayImageKey(image)}`)
            .sort(),
        },
  };
}

/** The parts an edit changes, in review order; none when it means the same. */
export function googleFormChanges(
  before: GoogleFormValues,
  after: GoogleFormValues,
): GoogleFormChange[] {
  const was = meaning(before);
  const now = meaning(after);
  return GOOGLE_FORM_CHANGES.filter(
    (part) => JSON.stringify(was[part]) !== JSON.stringify(now[part]),
  );
}
