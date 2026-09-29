import type { SocialPostStatus } from "@/lib/clients/generated/core/types.gen";

/**
 * One tab per section. Published and canceled posts have no section: the
 * calendar beside the list already shows them, and nothing can be done to
 * them. Failed and missed posts can still be retried or rescheduled, so they
 * keep a section of their own.
 */
export type SectionKey = "upcoming" | "drafts" | "attention";
export const SECTION_STATUSES: Record<SectionKey, readonly SocialPostStatus[]> =
  {
    upcoming: ["SCHEDULED", "PUBLISHING"],
    drafts: ["DRAFT"],
    attention: ["FAILED", "MISSED"],
  };
export const SECTION_ORDER: SectionKey[] = ["upcoming", "drafts", "attention"];
