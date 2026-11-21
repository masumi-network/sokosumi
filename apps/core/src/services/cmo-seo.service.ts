import { createHash } from "node:crypto";
import { Prisma } from "@sokosumi/database";
import { cmoSearchAdSchema } from "@sokosumi/soko-bot";
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import { pageOpening } from "@/lib/seo/landing-page-check";

import type { PresetRoute } from "@/lib/soko-bot/classifier";
import {
  type CmoSeo,
  type CmoSeoEvidence,
  type CmoSeoSuggestion,
  cmoSeoArticleInputSchema,
  cmoSeoEvidenceSchema,
  cmoSeoPageChangeInputSchema,
} from "@/schemas/cmo-seo.schema";
import { comparisonSearchVolume } from "@/services/cmo-competitor-keywords.service";
import {
  CmoConflictError,
  CmoNotFoundError,
  type Cuso,
  type CusoTarget,
  requireCuso,
  startCmoTurn,
} from "@/services/cmo-cuso.service";
import {
  type CmoSeoLandingPageInput,
  checkCmoLandingPage,
  landingPageSources,
} from "@/services/cmo-seo-landing-pages.service";

import { approvedMarketingStrategy } from "@/services/marketing-strategy.service";

import { normalizeSeoUrl } from "@/services/project-seo-store";

import {
  auditSuggestionKey,
  latestCmoSeoAudit,
  pageCarriesText,
  readCmoSeoAudit,
} from "./cmo-seo-audit.service";
import { cmoSeoMarket } from "./cmo-seo-market";

import {
  keywordSearchesLeft,
  normalizeKeyword,
  readCmoSearchConsole,
  recentKeywordSearches,
  siteSearchesFor,
  storedSearchConsole,
  withSiteSearches,
} from "./cmo-seo-research.service";

export {
  CMO_KEYWORD_SEARCHES_PER_DAY,
  keywordSearchesLeft,
  readCmoSearchConsole,
  searchCmoKeywords,
  searchConsoleOpportunities,
} from "./cmo-seo-research.service";

const KEYWORD_SEARCHES_SHOWN = 3;
export const CMO_SEO_SUGGESTIONS_PER_SAVE = 5;
const OPEN_SUGGESTIONS_MAX = 30;

export const CMO_SEO_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  reason: "CMO SEO: article ideas and drafts from real search data.",
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

// Suggestions: articles and page changes
// ---------------------------------------------------------------------------

const intOf = (value: number) => Math.round(value).toLocaleString("en-US");

/** The measured numbers for a keyword, each with its source and date. */
async function keywordEvidence(
  projectId: string,
  keyword: string,
  market: Awaited<ReturnType<typeof cmoSeoMarket>>,
): Promise<CmoSeoEvidence[]> {
  const wanted = normalizeKeyword(keyword);
  const [searches, audit, gsc] = await Promise.all([
    recentKeywordSearches(projectId, 30, market),
    latestCmoSeoAudit(projectId),
    storedSearchConsole(projectId),
  ]);
  const evidence: CmoSeoEvidence[] = [];
  const base = { keyword, pageUrl: null };
  const idea = searches
    .flatMap((search) =>
      search.ideas.map((item) => ({ item, observedAt: search.observedAt })),
    )
    .find(({ item }) => normalizeKeyword(item.keyword) === wanted);
  if (idea) {
    const at = idea.item.measuredAt ?? idea.observedAt.toISOString();
    if (idea.item.searchVolume !== null)
      evidence.push({
        ...base,
        metric: "searchVolume",
        value: intOf(idea.item.searchVolume),
        source: "keyword_research",
        observedAt: at,
      });
    if (idea.item.difficulty !== null)
      evidence.push({
        ...base,
        metric: "difficulty",
        value: String(idea.item.difficulty),
        source: "keyword_research",
        observedAt: at,
      });
    if (idea.item.intent)
      evidence.push({
        ...base,
        metric: "intent",
        value: idea.item.intent,
        source: "keyword_research",
        observedAt: at,
      });
  }
  // A search that names a competitor is read with the competitors' searches.
  const compared = idea
    ? null
    : await comparisonSearchVolume(projectId, keyword);
  if (compared)
    evidence.push({
      ...base,
      metric: "searchVolume",
      value: intOf(compared.searchVolume),
      source: "keyword_research",
      observedAt: compared.observedAt.toISOString(),
    });
  const audited = audit?.payload.keywords.find(
    (item) => normalizeKeyword(item.keyword) === wanted,
  );
  if (audit && audited) {
    const at = audit.observedAt.toISOString();
    if (!idea && !compared && audited.volume != null)
      evidence.push({
        ...base,
        metric: "searchVolume",
        value: intOf(audited.volume),
        source: "weekly_audit",
        observedAt: at,
      });
    evidence.push({
      ...base,
      metric: "position",
      value:
        audited.position !== null
          ? String(audited.position)
          : `not in the top ${audited.checkedResults ?? 10}`,
      source: "weekly_audit",
      observedAt: at,
    });
  }
  const rows = (gsc?.payload.rows ?? []).filter(
    (row) => normalizeKeyword(row.query) === wanted,
  );
  if (gsc && rows.length) {
    const at = gsc.observedAt.toISOString();
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const best = Math.min(...rows.map((row) => row.position ?? Infinity));
    evidence.push(
      {
        ...base,
        metric: "impressions",
        value: intOf(impressions),
        source: "search_console",
        observedAt: at,
      },
      {
        ...base,
        metric: "clicks",
        value: intOf(clicks),
        source: "search_console",
        observedAt: at,
      },
    );
    if (Number.isFinite(best))
      evidence.push({
        ...base,
        metric: "position",
        value: best.toFixed(1),
        source: "search_console",
        observedAt: at,
      });
  }
  return evidence;
}

/** The measured numbers for one page: its Search Console searches and the audit's issues on it. */
async function pageEvidence(
  projectId: string,
  pageUrl: string,
): Promise<CmoSeoEvidence[]> {
  const page = normalizeSeoUrl(pageUrl);
  const [audit, gsc] = await Promise.all([
    latestCmoSeoAudit(projectId),
    storedSearchConsole(projectId),
  ]);
  const evidence: CmoSeoEvidence[] = [];
  const rows = (gsc?.payload.rows ?? [])
    .filter((row) => normalizeSeoUrl(row.pageUrl) === page)
    .sort((a, b) => b.impressions - a.impressions);
  if (gsc && rows[0]) {
    const at = gsc.observedAt.toISOString();
    const top = rows[0];
    const base = { keyword: top.query, pageUrl };
    evidence.push(
      {
        ...base,
        metric: "impressions",
        value: intOf(top.impressions),
        source: "search_console",
        observedAt: at,
      },
      {
        ...base,
        metric: "clicks",
        value: intOf(top.clicks),
        source: "search_console",
        observedAt: at,
      },
    );
    if (top.position !== null)
      evidence.push({
        ...base,
        metric: "position",
        value: top.position.toFixed(1),
        source: "search_console",
        observedAt: at,
      });
    if (top.ctr !== null)
      evidence.push({
        ...base,
        metric: "ctr",
        value: `${(top.ctr * 100).toFixed(1)}%`,
        source: "search_console",
        observedAt: at,
      });
  }
  const findings = (audit?.payload.findings ?? []).filter(
    (finding) =>
      normalizeSeoUrl(finding.pageUrl) === page &&
      ["critical", "major", "minor"].includes(finding.severity),
  );
  for (const finding of new Map(findings.map((f) => [f.rowId, f])).values())
    evidence.push({
      metric: "auditIssue",
      keyword: null,
      pageUrl,
      value: finding.title,
      source: "weekly_audit",
      observedAt: audit!.observedAt.toISOString(),
    });
  return evidence.slice(0, 8);
}

/** The latest audit's own fixes, as page changes on the to-do list. Made once each. */
async function seedAuditPageChanges(projectId: string): Promise<void> {
  const audit = await latestCmoSeoAudit(projectId);
  if (!audit) return;
  const at = audit.observedAt.toISOString();
  const rowIdOf = new Map(
    audit.payload.findings.map((finding) => [finding.id, finding.rowId]),
  );
  for (const action of audit.payload.actions) {
    // A report of several pages prefixes its finding ids with the page's index.
    const rowIds = action.findingIds.flatMap((id) => rowIdOf.get(id) ?? []);
    if (rowIds.length === 0) continue;
    const key = auditSuggestionKey(action.pageUrl, rowIds);
    const findings = audit.payload.findings.filter(
      (finding) =>
        rowIds.includes(finding.rowId) &&
        normalizeSeoUrl(finding.pageUrl) === normalizeSeoUrl(action.pageUrl),
    );
    const evidence: CmoSeoEvidence[] = [
      ...new Map(findings.map((f) => [f.rowId, f])).values(),
    ].map((finding) => ({
      metric: "auditIssue",
      keyword: null,
      pageUrl: action.pageUrl,
      value: finding.title,
      source: "weekly_audit",
      observedAt: at,
    }));
    await prisma.projectSeoSuggestion.upsert({
      where: { projectId_key: { projectId, key } },
      create: {
        projectId,
        kind: "page_change",
        key,
        source: "audit",
        observationId: audit.id,
        title: action.title,
        pageUrl: action.pageUrl,
        why: action.why,
        body: action.edit
          ? `Change the ${action.edit.target}${action.edit.before ? ` from "${action.edit.before}"` : ""}.`
          : action.expectedEffect,
        newText: action.edit?.after ?? null,
        evidence,
      },
      update: {},
    });
  }
}

export function toSuggestion(
  row: Prisma.ProjectSeoSuggestionGetPayload<object>,
): CmoSeoSuggestion {
  const evidence = z.array(cmoSeoEvidenceSchema).safeParse(row.evidence);
  return {
    id: row.id,
    kind:
      row.kind === "article" || row.kind === "landing_page"
        ? row.kind
        : "page_change",
    source: row.source === "audit" ? "audit" : "cuso",
    title: row.title,
    keyword: row.keyword,
    pageUrl: row.pageUrl,
    why: row.why,
    body: row.body,
    newText: row.newText,
    currentText: row.currentText,
    element:
      (["title", "description", "heading", "text"] as const).find(
        (element) => element === row.element,
      ) ?? null,
    draft: row.draft,
    sources: row.kind === "landing_page" ? landingPageSources(row.body) : [],
    evidence: evidence.success ? evidence.data : [],
    status: (["open", "done", "verified", "dismissed"] as const).find(
      (status) => status === row.status,
    )!,
    createdAt: row.createdAt.toISOString(),
    doneAt: row.doneAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  };
}

export {
  cmoSeoArticleInputSchema,
  cmoSeoPageChangeInputSchema,
} from "@/schemas/cmo-seo.schema";

function sameHost(url: string, websiteUrl: string): boolean {
  const host = (value: string) =>
    new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  return (
    URL.canParse(url) &&
    URL.canParse(websiteUrl) &&
    host(url) === host(websiteUrl)
  );
}

/**
 * Saves Cuso's articles and page changes. Core attaches the measured numbers
 * itself and refuses a suggestion it has no numbers for, so no number on the
 * SEO tab is ever one Cuso made up.
 */
export async function saveCmoSeoSuggestions(
  cuso: Cuso,
  input: {
    articles?: z.infer<typeof cmoSeoArticleInputSchema>[];
    pageChanges?: z.infer<typeof cmoSeoPageChangeInputSchema>[];
    landingPages?: CmoSeoLandingPageInput[];
  },
): Promise<{
  saved: Array<{ id: string; title: string }>;
  refused: string[];
  /** What checking the landing pages cost. */
  costUsd: number;
}> {
  const articles = input.articles ?? [];
  const pageChanges = input.pageChanges ?? [];
  const landingPages = input.landingPages ?? [];
  let costUsd = 0;
  if (articles.length + pageChanges.length > CMO_SEO_SUGGESTIONS_PER_SAVE)
    throw new CmoConflictError(
      `Save at most ${CMO_SEO_SUGGESTIONS_PER_SAVE} suggestions at once.`,
    );
  const open = await prisma.projectSeoSuggestion.count({
    where: { projectId: cuso.projectId, status: "open" },
  });
  const market = await cmoSeoMarket(cuso);
  const saved: Array<{ id: string; title: string }> = [];
  const refused: string[] = [];
  let added = 0;
  /**
   * Where a suggestion goes: the row Cuso named or the one with its key, a
   * new row, or nowhere, with the reason for Cuso.
   */
  const place = async (
    suggestion: { id?: string; title: string },
    kind: string,
    key: string,
  ): Promise<{ id: string | null } | { refusal: string }> => {
    const select = { id: true, status: true } as const;
    const row =
      (suggestion.id
        ? await prisma.projectSeoSuggestion.findFirst({
            where: { id: suggestion.id, projectId: cuso.projectId, kind },
            select,
          })
        : null) ??
      (await prisma.projectSeoSuggestion.findUnique({
        where: { projectId_key: { projectId: cuso.projectId, key } },
        select,
      }));
    // read_seo hides what the owner skipped, so Cuso cannot know.
    if (row?.status === "dismissed")
      return {
        refusal: `"${suggestion.title}": the owner skipped this one, so it was not saved. Suggest something else.`,
      };
    if (row) return { id: row.id };
    if (open + added >= OPEN_SUGGESTIONS_MAX)
      return {
        refusal: `"${suggestion.title}": the list already holds ${OPEN_SUGGESTIONS_MAX} open suggestions.`,
      };
    added += 1;
    return { id: null };
  };
  for (const article of articles) {
    const evidence = await keywordEvidence(
      cuso.projectId,
      article.keyword,
      market,
    );
    if (!evidence.some((item) => item.metric !== "intent")) {
      refused.push(
        `"${article.title}": no measured data for "${article.keyword}". Run research_keywords on its topic first, then use a keyword it returned.`,
      );
      continue;
    }
    const data = {
      title: article.title,
      keyword: article.keyword,
      why: article.why,
      body: article.outline,
      evidence,
      ...(article.draft ? { draft: article.draft } : {}),
    };
    const key = `article:${normalizeKeyword(article.keyword)}`;
    const placed = await place(article, "article", key);
    if ("refusal" in placed) {
      refused.push(placed.refusal);
      continue;
    }
    const row = placed.id
      ? await prisma.projectSeoSuggestion.update({
          where: { id: placed.id },
          data,
        })
      : await prisma.projectSeoSuggestion.create({
          data: {
            projectId: cuso.projectId,
            kind: "article",
            key,
            source: "cuso",
            ...data,
          },
        });
    saved.push({ id: row.id, title: row.title });
  }
  for (const change of pageChanges) {
    if (!sameHost(change.pageUrl, cuso.websiteUrl)) {
      refused.push(
        `"${change.title}": ${change.pageUrl} is not on ${cuso.websiteUrl}.`,
      );
      continue;
    }
    const evidence = [
      ...(await pageEvidence(cuso.projectId, change.pageUrl)),
      ...(change.keyword
        ? await keywordEvidence(cuso.projectId, change.keyword, market)
        : []),
    ];
    if (evidence.length === 0) {
      refused.push(
        `"${change.title}": no measured data for ${change.pageUrl} yet (no Search Console rows and no audit issue). Pick a page from read_seo.`,
      );
      continue;
    }
    // The before is what the live page says; a page Core cannot read keeps the change without it.
    const before = change.currentText
      ? await pageCarriesText(change.pageUrl, change.currentText)
      : null;
    if (before === false) {
      refused.push(
        `"${change.title}": ${change.pageUrl} does not say "${change.currentText}". Read the page and copy currentText from it word for word.`,
      );
      continue;
    }
    const data = {
      pageUrl: change.pageUrl,
      title: change.title,
      body: change.change,
      newText: change.newText,
      currentText: before ? change.currentText : null,
      element: before ? (change.element ?? "text") : null,
      why: change.why,
      keyword: change.keyword ?? null,
      evidence,
    };
    const key = `page:${normalizeSeoUrl(change.pageUrl)}:${hash(normalizeKeyword(change.title))}`;
    const placed = await place(change, "page_change", key);
    if ("refusal" in placed) {
      refused.push(placed.refusal);
      continue;
    }
    const row = placed.id
      ? await prisma.projectSeoSuggestion.update({
          where: { id: placed.id },
          data,
        })
      : await prisma.projectSeoSuggestion.create({
          data: {
            projectId: cuso.projectId,
            kind: "page_change",
            key,
            source: "cuso",
            ...data,
          },
        });
    saved.push({ id: row.id, title: row.title });
  }
  for (const page of landingPages) {
    const title = pageOpening(page.draft).heading ?? page.keyword;
    const evidence = await keywordEvidence(
      cuso.projectId,
      page.keyword,
      market,
    );
    if (!evidence.some((item) => item.metric === "searchVolume")) {
      refused.push(
        `"${title}": no measured searches for "${page.keyword}". Use a search research_competitor_keywords returned, spelled the same.`,
      );
      continue;
    }
    const checked = await checkCmoLandingPage(cuso, page);
    costUsd += checked.costUsd;
    if (checked.problems.length > 0) {
      refused.push(`"${title}": ${checked.problems.join(" ")}`);
      continue;
    }
    const data = {
      title,
      keyword: page.keyword,
      why: page.why,
      body: JSON.stringify(page.claims),
      draft: page.draft,
      evidence,
    };
    const key = `landing:${normalizeKeyword(page.keyword)}`;
    const placed = await place({ id: page.id, title }, "landing_page", key);
    if ("refusal" in placed) {
      refused.push(placed.refusal);
      continue;
    }
    const row = placed.id
      ? await prisma.projectSeoSuggestion.update({
          where: { id: placed.id },
          data,
        })
      : await prisma.projectSeoSuggestion.create({
          data: {
            projectId: cuso.projectId,
            kind: "landing_page",
            key,
            source: "cuso",
            ...data,
          },
        });
    saved.push({ id: row.id, title: row.title });
  }
  return { saved, refused, costUsd };
}

/**
 * The owner published a landing page: it is done at that address, and every
 * search ad on its search that is not launched yet sends people there. A
 * launched ad keeps its address; changing a running campaign stays a
 * deliberate step.
 */
export async function markCmoLandingPageLive(
  target: CusoTarget,
  id: string,
  url: string,
  now: Date = new Date(),
): Promise<{
  page: CmoSeoSuggestion;
  adsUpdated: number;
  adsLaunched: number;
}> {
  const cuso = await requireCuso(target);
  const row = await prisma.projectSeoSuggestion.findFirst({
    where: { id, projectId: cuso.projectId, kind: "landing_page" },
  });
  if (!row) throw new CmoNotFoundError("Landing page not found");
  if (!sameHost(url, cuso.websiteUrl))
    throw new CmoConflictError(
      `That address is not on ${new URL(cuso.websiteUrl).hostname}. Paste the page's address on your own site.`,
    );
  const search = normalizeKeyword(row.keyword ?? "");
  const approved = await approvedMarketingStrategy(cuso.projectId);
  const ads = approved
    ? (
        await prisma.marketingStrategyFile.findMany({
          where: {
            marketingStrategyId: approved.id,
            searchAd: { not: Prisma.DbNull },
          },
          select: { id: true, searchAd: true, adCampaignId: true },
        })
      ).flatMap((file) => {
        const ad = cmoSearchAdSchema.safeParse(file.searchAd);
        return ad.success &&
          ad.data.keywords.some(
            (keyword) => normalizeKeyword(keyword) === search,
          )
          ? [{ ...file, ad: ad.data }]
          : [];
      })
    : [];
  const waiting = ads.filter((file) => !file.adCampaignId);
  const [page] = await prisma.$transaction([
    prisma.projectSeoSuggestion.update({
      where: { id },
      data: { pageUrl: url, status: "done", doneAt: now },
    }),
    ...waiting.map((file) =>
      prisma.marketingStrategyFile.update({
        where: { id: file.id },
        data: { searchAd: { ...file.ad, finalUrl: url } },
      }),
    ),
  ]);
  return {
    page: toSuggestion(page),
    adsUpdated: waiting.length,
    adsLaunched: ads.length - waiting.length,
  };
}

export async function setCmoSeoSuggestionStatus(
  target: CusoTarget,
  id: string,
  status: "open" | "done" | "dismissed",
  now: Date = new Date(),
): Promise<CmoSeoSuggestion> {
  const cuso = await requireCuso(target);
  const row = await prisma.projectSeoSuggestion.findFirst({
    where: { id, projectId: cuso.projectId },
  });
  if (!row) throw new CmoNotFoundError("Suggestion not found");
  return toSuggestion(
    await prisma.projectSeoSuggestion.update({
      where: { id },
      data: {
        status,
        doneAt: status === "done" ? now : null,
        checkedAt: null,
        verifiedAt: null,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export async function readCmoSeo(
  target: CusoTarget | Cuso,
  now: Date = new Date(),
): Promise<CmoSeo> {
  const cuso = "sokoBotId" in target ? target : await requireCuso(target);
  await seedAuditPageChanges(cuso.projectId);
  const [market, audit, searchConsole, suggestions, searches, left] =
    await Promise.all([
      cmoSeoMarket(cuso),
      readCmoSeoAudit(cuso),
      readCmoSearchConsole(cuso, now),
      prisma.projectSeoSuggestion.findMany({
        where: { projectId: cuso.projectId, status: { not: "dismissed" } },
        orderBy: [{ createdAt: "desc" }],
        take: 100,
      }),
      recentKeywordSearches(cuso.projectId, KEYWORD_SEARCHES_SHOWN),
      keywordSearchesLeft(cuso.projectId, now),
    ]);
  const site = await siteSearchesFor(cuso.projectId);
  const all = suggestions.map(toSuggestion);
  return {
    websiteUrl: cuso.websiteUrl,
    countryCode: market.countryCode,
    languageCode: market.languageCode,
    audit,
    searchConsole,
    articles: all.filter((item) => item.kind === "article"),
    pageChanges: all.filter((item) => item.kind === "page_change"),
    landingPages: all.filter((item) => item.kind === "landing_page"),
    keywordSearches: searches.map((search) => ({
      topic: search.topic,
      countryCode: search.countryCode,
      languageCode: search.languageCode,
      observedAt: search.observedAt.toISOString(),
      ideas: withSiteSearches(search.topic, search.ideas, site),
    })),
    keywordSearchesLeft: left,
  };
}

/** "More article ideas": Cuso researches and saves new articles; his answer lands in the chat. */
export async function requestCmoArticleIdeas(
  target: CusoTarget,
): Promise<{ turnId: string }> {
  const cuso = await requireCuso(target);
  return startCmoTurn(cuso, target.userId, {
    clientTurnId: `cmo:seo-ideas:${cuso.sokoBotId}:${Date.now()}`,
    message: [
      `The owner asked for more article ideas for ${cuso.businessName}'s website (SEO tab).`,
      "Call read_seo, then research_keywords on two or three topics the Brand Brain says buyers search for and the site does not cover yet. Pick three keywords with real searches, a difficulty the site can win and the intent of a future customer, and that no open article already targets.",
      "A keyword has real searches when research gives it a monthly volume, or when Search Console shows Google already lists the site for it (impressions, a position below the top three). In a small market most searches have no measured volume: then pick from the Search Console ones.",
      "Save them with save_seo_suggestions as articles: title, keyword exactly as research_keywords or read_seo returned it, why (the numbers and the business reason) and an outline. Do not write the full text now.",
      "Then answer in two short sentences: what you added and why.",
    ].join("\n"),
    route: CMO_SEO_ROUTE,
  });
}

/** "Write an article": Cuso picks the best search and writes one whole article. */
export async function requestCmoArticle(
  target: CusoTarget,
): Promise<{ turnId: string }> {
  const cuso = await requireCuso(target);
  return startCmoTurn(cuso, target.userId, {
    clientTurnId: `cmo:seo-article:${cuso.sokoBotId}:${Date.now()}`,
    message: [
      `The owner asked you to write one new article for ${cuso.businessName}'s website (SEO page).`,
      "Call read_seo, then research_keywords on one or two topics the Brand Brain says buyers search for. Pick the one search worth most that no open article targets: a monthly volume from research, or one Google already shows the site for in Search Console (impressions, a position below the top three).",
      "Read the seo writing skill first and follow it. Write the whole article with facts only from the Brand Brain and the site, written as the business's own words: it never names the Brand Brain, your tools, the SEO page or where a fact came from. Save it with save_seo_suggestions as an article: title, keyword exactly as research_keywords or read_seo returned it, why (the numbers and the business reason), outline, and the whole article in Markdown as draft.",
      "Then answer in one short sentence: its title, its search, and that it is on the SEO page, ready to copy.",
    ].join("\n"),
    route: CMO_SEO_ROUTE,
  });
}

/** "Write the article": Cuso writes the full draft of one suggestion. */
export async function requestCmoArticleDraft(
  target: CusoTarget,
  id: string,
): Promise<{ turnId: string }> {
  const cuso = await requireCuso(target);
  const row = await prisma.projectSeoSuggestion.findFirst({
    where: { id, projectId: cuso.projectId, kind: "article" },
  });
  if (!row) throw new CmoNotFoundError("Article not found");
  return startCmoTurn(cuso, target.userId, {
    clientTurnId: `cmo:seo-draft:${id}:${Date.now()}`,
    message: [
      `The owner asked you to write the article "${row.title}" in full (SEO tab, suggestion ${row.id}).`,
      `Target keyword: ${row.keyword}. Outline:\n${row.body}`,
      "Read the seo writing skill first and follow it. Use only facts from the Brand Brain and the site, written as the business's own words: the article never names the Brand Brain, your tools, the SEO tab or where a fact came from. Save it with save_seo_suggestions: the same id, title, keyword, why and outline, and the whole article in Markdown as draft.",
      "Then answer in one short sentence that the draft is ready in the SEO tab.",
    ].join("\n"),
    route: CMO_SEO_ROUTE,
  });
}
