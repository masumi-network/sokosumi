/** Statuses a user (or bot) may set on a campaign. Providers report more. */
export const AD_CAMPAIGN_SETTABLE_STATUSES = ["ACTIVE", "PAUSED"] as const;
export type AdCampaignSettableStatus =
  (typeof AD_CAMPAIGN_SETTABLE_STATUSES)[number];

export const GOOGLE_KEYWORD_MATCH_TYPES = ["BROAD", "PHRASE", "EXACT"] as const;
export type GoogleKeywordMatchType =
  (typeof GOOGLE_KEYWORD_MATCH_TYPES)[number];

/** LOGO is a square (1:1) logo, at least 128×128; it fills `square_logo_images`. */
export const GOOGLE_DISPLAY_IMAGE_ROLES = [
  "LANDSCAPE",
  "SQUARE",
  "LOGO",
] as const;
export type GoogleDisplayImageRole =
  (typeof GOOGLE_DISPLAY_IMAGE_ROLES)[number];
