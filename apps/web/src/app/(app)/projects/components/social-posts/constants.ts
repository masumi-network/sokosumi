import type { SocialPostStatus } from "@sokosumi/core-client";

/**
 * One tab per list. Scheduled, published and canceled posts have no list: the
 * calendar tab already shows them, and a post a link names is shown above the
 * tabs. Publishing stays on Drafts until it finishes. Failed and missed posts
 * can still be retried, rescheduled, or dismissed, so they keep a list of their own.
 */
export type SectionKey = "drafts" | "attention";
export const SECTION_STATUSES: Record<SectionKey, readonly SocialPostStatus[]> =
  {
    drafts: ["DRAFT", "NEEDS_APPROVAL", "PUBLISHING"],
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
