import {
  CMO_SEO_BEFORE_AFTER_CASE_ID,
  CMO_SEO_REPORT_CASE_IDS,
  CMO_SEO_WEEKLY_REPORT_CASE_ID,
  CMO_SEO_WRITE_ARTICLE_CASE_ID,
  type ScenarioCheck,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import type { EvalLaneRecord } from "./eval-lanes.service";

export function isCmoSeoReportCase(caseId: string): boolean {
  return CMO_SEO_REPORT_CASE_IDS.includes(caseId);
}

const row = (
  query: string,
  pageUrl: string,
  impressions: number,
  clicks: number,
  position: number,
) => ({
  query,
  pageUrl,
  impressions,
  clicks,
  ctr: clicks / impressions,
  position,
});

/**
 * Search Console for cal.com as a connected Cuso reads it: a stand-in
 * connection (an `eval:` id, never called) and a payload stored now, so
 * read_seo shows it without asking Google. Real pages, so Cuso and Core can
 * read what they say today.
 */
export async function prepareCmoSeoReport(lane: EvalLaneRecord): Promise<void> {
  const now = new Date();
  await prisma.sokoBotIntegration.upsert({
    where: {
      sokoBotId_provider: {
        sokoBotId: lane.cusoBotId,
        provider: "google_search_console",
      },
    },
    create: {
      sokoBotId: lane.cusoBotId,
      provider: "google_search_console",
      status: "ACTIVE",
      composioAccountId: `eval:gsc-${lane.lane}`,
    },
    update: { status: "ACTIVE", composioAccountId: `eval:gsc-${lane.lane}` },
  });
  const payload = {
    property: "sc-domain:cal.com",
    from: "2026-10-20",
    to: "2026-11-16",
    totals: { clicks: 412, impressions: 18_940, ctr: 0.0218, position: 14.6 },
    previousTotals: {
      clicks: 368,
      impressions: 17_210,
      ctr: 0.0214,
      position: 15.9,
    },
    rows: [
      row("scheduling software", "https://cal.com/", 4_200, 61, 9.4),
      row("online booking software", "https://cal.com/", 1_820, 14, 11.8),
      row("open source scheduling", "https://cal.com/", 1_310, 52, 4.2),
      row("calendly alternative", "https://cal.com/", 960, 9, 12.6),
      row("cal com pricing", "https://cal.com/pricing", 880, 210, 1.3),
      row(
        "scheduling software pricing",
        "https://cal.com/pricing",
        640,
        3,
        13.1,
      ),
      row("team scheduling app", "https://cal.com/", 410, 6, 16.4),
    ],
  };
  await prisma.projectSeoResearch.upsert({
    where: {
      projectId_kind_key: {
        projectId: lane.cusoProjectId,
        kind: "search_console",
        key: "latest",
      },
    },
    create: {
      projectId: lane.cusoProjectId,
      kind: "search_console",
      key: "latest",
      payload,
      observedAt: now,
    },
    update: { payload, observedAt: now },
  });
  // Each case starts without what an earlier one saved.
  await prisma.projectSeoSuggestion.deleteMany({
    where: { projectId: lane.cusoProjectId, source: "cuso" },
  });
}

/** Takes the stand-in Search Console off the lane, so no other case sees it. */
export async function clearCmoSeoReport(lane: EvalLaneRecord): Promise<void> {
  await prisma.sokoBotIntegration.deleteMany({
    where: {
      sokoBotId: lane.cusoBotId,
      provider: "google_search_console",
      composioAccountId: { startsWith: "eval:gsc-" },
    },
  });
  await prisma.projectSeoResearch.deleteMany({
    where: { projectId: lane.cusoProjectId, kind: "search_console" },
  });
}

const WORDS_MAX = 160;
const ARTICLE_WORDS_MIN = 500;
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** What a cmo-v12 SEO case left on the SEO page, checked beside the judge. */
export async function cmoSeoReportChecks(
  lane: EvalLaneRecord,
  caseId: string,
  since: Date,
  answer: string,
): Promise<ScenarioCheck[]> {
  const saved = await prisma.projectSeoSuggestion.findMany({
    where: { projectId: lane.cusoProjectId, updatedAt: { gte: since } },
    select: {
      kind: true,
      element: true,
      currentText: true,
      newText: true,
      draft: true,
    },
  });
  const beforeAfter = saved.filter(
    (s) => s.kind === "page_change" && s.currentText,
  );
  if (caseId === CMO_SEO_WEEKLY_REPORT_CASE_ID)
    return [
      {
        label: "Saves a page change with its before and after",
        pass: beforeAfter.length > 0,
        actual: `${beforeAfter.length} of ${saved.filter((s) => s.kind === "page_change").length} page changes`,
      },
      {
        label: `The message stays under ${WORDS_MAX} words`,
        pass: words(answer) <= WORDS_MAX,
        actual: `${words(answer)} words`,
      },
    ];
  if (caseId === CMO_SEO_BEFORE_AFTER_CASE_ID) {
    const title = beforeAfter.find((s) => s.element === "title");
    return [
      {
        label: "Saves the homepage title with what it says today",
        pass: !!title,
        actual: title
          ? `"${title.currentText}" → "${title.newText}"`
          : "no title change with its before",
      },
      {
        label: "The new title fits in 60 characters",
        pass: !!title?.newText && title.newText.length <= 60,
        actual: `${title?.newText?.length ?? 0} characters`,
      },
    ];
  }
  if (caseId === CMO_SEO_WRITE_ARTICLE_CASE_ID) {
    const article = saved.find((s) => s.kind === "article" && s.draft);
    return [
      {
        label: `Saves a whole article of ${ARTICLE_WORDS_MIN} words or more`,
        pass: !!article?.draft && words(article.draft) >= ARTICLE_WORDS_MIN,
        actual: article?.draft
          ? `${words(article.draft)} words`
          : "no article with its text",
      },
    ];
  }
  return [];
}
