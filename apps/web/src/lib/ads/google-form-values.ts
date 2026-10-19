import type { AdCampaignDetails } from "@sokosumi/core-client";

import {
  GOOGLE_DISPLAY_LIMITS,
  type GoogleDisplayFormValues,
} from "./google-display";
import { formatGoogleKeyword } from "./google-keywords";
import {
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
