import type { SocialPostStatus } from "@/lib/clients/generated/core/types.gen";

export type SectionKey = "upcoming" | "drafts" | "history";
export const SECTION_STATUSES: Record<SectionKey, readonly SocialPostStatus[]> =
  {
    upcoming: ["SCHEDULED", "PUBLISHING"],
    drafts: ["DRAFT"],
    history: ["PUBLISHED", "FAILED", "MISSED", "CANCELED"],
  };
export const SECTION_ORDER: SectionKey[] = ["upcoming", "drafts", "history"];
