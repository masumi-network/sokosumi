import type { SocialPostStatus } from "@sokosumi/core-client";

/**
 * Scheduled, published and canceled posts have no list: the
 * calendar tab already shows them, and a post a link names is shown above the
 * tabs. Publishing stays on Drafts until it finishes. Waiting posts appear above
 * drafts and in Needs attention alongside failed and missed posts.
 */
export type SectionKey = "drafts" | "attention";
export const SECTION_STATUSES: Record<SectionKey, readonly SocialPostStatus[]> =
  {
    drafts: ["DRAFT", "PUBLISHING", "NEEDS_APPROVAL"],
    attention: ["FAILED", "MISSED", "NEEDS_APPROVAL"],
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
