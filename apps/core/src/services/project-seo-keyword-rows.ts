import { z } from "@hono/zod-openapi";
import type { ProjectSeoKeyword } from "@sokosumi/database";
import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import { seoKeywordClicks } from "@/lib/seo/keyword-clicks";
import {
  type ProjectSeoWorkspace,
  saveSeoKeywordSchema,
} from "@/schemas/project-seo.schema";

type SeoKeywordRow = ProjectSeoWorkspace["keywords"][number];
/** Why a check lists a keyword it did not set out to read. The SEO tab shows these as ideas (web: SEO_IDEA_SOURCES). */
const IDEA_SOURCES = new Set(["gap", "opportunity"]);
const priority = z.enum(["low", "medium", "high"]);

/** A keyword a check read or listed, with the reader's choice for it when there is one. */
export function observedSeoKeyword(
  item: PublicSeoPayload["keywords"][number],
  choice: ProjectSeoKeyword | undefined,
  at: {
    id: string;
    observationId: string;
    countryCode: string;
    languageCode: string;
    /** The check's Market is one the save schema takes. */
    trackable: boolean;
  },
): SeoKeywordRow {
  const volume = item.volume ?? null;
  return {
    ...item,
    id: at.id,
    observationId: at.observationId,
    countryCode: at.countryCode,
    languageCode: at.languageCode,
    // No choice of the reader yet: a keyword the check read, or set out to read, is tracked.
    // An idea the check only lists waits for the reader.
    saved:
      choice?.saved ??
      (at.trackable &&
        // The same holds for a keyword the save schema refuses or stores under another spelling.
        saveSeoKeywordSchema.shape.keyword.safeParse(item.keyword).data ===
          item.keyword &&
        !(
          IDEA_SOURCES.has(item.source ?? "") &&
          item.positionStatus === "unavailable"
        )),
    targetPageId: choice?.pageId ?? null,
    priority: priority.parse(choice?.priority ?? "medium"),
    version: choice?.version ?? 0,
    source: item.source ?? "rank_refresh",
    volume,
    difficulty: item.difficulty ?? null,
    clicks: seoKeywordClicks(volume, item.position),
    intent: item.intent ?? null,
    conversion: item.conversion ?? null,
    feature: item.feature ?? null,
  };
}

/** A keyword the reader keeps that no check in view read: no numbers yet. */
export function savedSeoKeyword(
  choice: ProjectSeoKeyword,
  pageUrl: string | null,
): SeoKeywordRow {
  return {
    id: choice.id,
    keyword: choice.keyword,
    pageUrl,
    targetPageId: choice.pageId,
    saved: choice.saved,
    countryCode: choice.countryCode,
    languageCode: choice.languageCode,
    source: "saved",
    volume: null,
    difficulty: null,
    clicks: null,
    intent: null,
    conversion: null,
    feature: null,
    device: null,
    position: null,
    positionStatus: "unavailable",
    checkedResults: null,
    observedAt: null,
    observationId: null,
    priority: priority.parse(choice.priority),
    version: choice.version,
  };
}
