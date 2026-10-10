import type { SocialPostStatus } from "@sokosumi/core-client";

/**
 * One tab per list. Scheduled, published and canceled posts have no list: the
 * calendar tab already shows them, and a post a link names is shown above the
 * tabs. Failed and missed posts can still be retried or rescheduled, so they
 * keep a list of their own.
 */
export type SectionKey = "drafts" | "attention";
export const SECTION_STATUSES: Record<SectionKey, readonly SocialPostStatus[]> =
  {
    drafts: ["DRAFT"],
    attention: ["FAILED", "MISSED"],
  };
export const SECTION_ORDER: SectionKey[] = ["drafts", "attention"];

/** Social's tabs, in order. `calendar` and `accounts` appear only on Social's own page. */
export const SOCIAL_TABS = [
  "calendar",
  "drafts",
  "attention",
  "statistics",
  "accounts",
] as const;
export type SocialTab = (typeof SOCIAL_TABS)[number];

/** Social tab row: 44px phone targets, scroll from the start beside New post. */
export const SOCIAL_TABS_LIST_CLASS_NAME =
  "app-scrollbar h-auto min-h-11 w-full min-w-0 max-w-full flex-1 justify-start overflow-x-auto overscroll-x-contain";
export const SOCIAL_TAB_TRIGGER_CLASS_NAME =
  "h-auto min-h-11 shrink-0 md:min-h-8";
