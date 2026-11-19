import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  RuntimeEventLog,
  runtimeEvent,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import type { CmoSeo } from "@/schemas/cmo-seo.schema";
import { CmoError, findCusoForBot } from "@/services/cmo-cuso.service";
import {
  readCmoSeo,
  saveCmoSeoSuggestions,
  searchCmoKeywords,
} from "@/services/cmo-seo.service";
import { checkCmoSearchRankings } from "@/services/cmo-seo-rankings.service";
import { registerSeoCheckWatch } from "@/services/soko-bot-watches.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

const IDEAS_SHOWN = 30;

/** What Cuso reads of the SEO tab: the numbers, without the drafts' full text. */
function forCuso(seo: CmoSeo) {
  const suggestion = (item: CmoSeo["articles"][number]) => ({
    id: item.id,
    title: item.title,
    keyword: item.keyword,
    pageUrl: item.pageUrl,
    status: item.status,
    from: item.source === "audit" ? "weekly audit" : "you",
    hasDraft: item.draft !== null,
    numbers: item.evidence.map(
      (e) =>
        `${e.metric} ${e.value}${e.keyword ? ` for "${e.keyword}"` : ""} (${e.source.replace("_", " ")}, ${e.observedAt.slice(0, 10)})`,
    ),
  });
  return {
    website: seo.websiteUrl,
    market: `${seo.countryCode}, ${seo.languageCode}`,
    weeklyAudit: {
      status: seo.audit.status,
      creditsPerAudit: seo.audit.creditsPerAudit,
      nextRunAt: seo.audit.nextRunAt,
      running: seo.audit.running,
      skippedForCredits: seo.audit.skipped,
      latest: seo.audit.latest,
      lastFailedAt: seo.audit.lastFailedAt,
    },
    searchConsole: seo.searchConsole,
    articles: seo.articles.map(suggestion),
    pageChanges: seo.pageChanges.map((item) => ({
      ...suggestion(item),
      newText: item.newText,
    })),
    recentKeywordSearches: seo.keywordSearches.map((search) => ({
      topic: search.topic,
      date: search.observedAt.slice(0, 10),
      ideas: search.ideas.slice(0, 10),
    })),
  };
}

async function taint(
  authorized: AuthorizedSokoBotRuntime,
  input: ExecuteSokoBotToolInput,
) {
  // Keyword lists and search results are other sites' words.
  await new RuntimeEventLog(authorized.turn.id, input.sessionId).append(
    runtimeEvent(WEB_TAINT_EVENT, { source: "cmo_seo" }),
  );
}

export async function executeCmoSeoTool(
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  const cuso = await findCusoForBot(authorized.turn.sokoBotId);
  if (!cuso)
    throw new SokoBotRuntimeValidationError(
      "Only a CMO assistant has an SEO tab.",
    );
  try {
    switch (input.capability) {
      case "read_seo": {
        const seo = await readCmoSeo(cuso);
        await taint(authorized, input);
        return forCuso(seo);
      }
      case "research_keywords": {
        const { topic } = SOKO_BOT_TOOL_INPUT_SCHEMAS.research_keywords.parse(
          input.input,
        );
        const search = await searchCmoKeywords(cuso, topic);
        await taint(authorized, input);
        return {
          ...search,
          ideas: search.ideas.slice(0, IDEAS_SHOWN),
          note: "Volume is Google searches a month in this market; difficulty runs 0 to 100. Quote these numbers with this date; never estimate others.",
        };
      }
      case "check_search_rankings": {
        const { keywords, then } =
          SOKO_BOT_TOOL_INPUT_SCHEMAS.check_search_rankings.parse(input.input);
        // This turn answers a check that failed or timed out: another one
        // from here would wait and follow up again, without the owner's word.
        const answering = await prisma.sokoBotWatch.findFirst({
          where: { firedTurnId: authorized.turn.id, kind: "seo_check" },
          select: { id: true },
        });
        if (answering)
          return {
            status: "unavailable",
            note: "This follow-up is the answer to the check you asked for. If it failed or did not finish, tell the owner so plainly, give the numbers you have, and ask whether to check again; start no new check now.",
          };
        const check = await checkCmoSearchRankings(cuso, keywords);
        if (check.status === "started" || check.status === "running") {
          await registerSeoCheckWatch(authorized, {
            analysisId: check.analysisId,
            projectId: cuso.projectId,
            then,
          });
          return {
            status: check.status,
            // What the owner's chat shows this check by, while it runs and after.
            analysisId: check.analysisId,
            note: "The SEO specialist is checking now; it usually takes a few minutes. End your turn: tell the owner in one sentence that you asked the SEO specialist and will answer here once the result is in. Core wakes you with it.",
          };
        }
        if (check.status === "done") {
          await taint(authorized, input);
          return {
            status: "done",
            result: check.outcome,
            note: "Checked in the last day: answer from this result now.",
          };
        }
        return {
          status: check.status,
          note: "message" in check ? check.message : "",
        };
      }
      case "save_seo_suggestions": {
        const parsed = SOKO_BOT_TOOL_INPUT_SCHEMAS.save_seo_suggestions.parse(
          input.input,
        );
        const result = await saveCmoSeoSuggestions(cuso, parsed);
        if (result.saved.length === 0)
          throw new SokoBotRuntimeValidationError(
            `Nothing was saved. ${result.refused.join(" ")}`,
          );
        return {
          ...result,
          note: "Saved to the owner's SEO tab, with the measured numbers Core attached.",
        };
      }
      default:
        throw new SokoBotRuntimeValidationError("Unsupported SEO capability");
    }
  } catch (error) {
    if (error instanceof CmoError)
      throw new SokoBotRuntimeValidationError(error.message);
    if (
      input.capability === "research_keywords" &&
      !(error instanceof SokoBotRuntimeValidationError)
    )
      throw new SokoBotRuntimeValidationError(
        "Keyword research is unavailable right now. Answer from read_seo, and tell the owner the numbers will come once it works again.",
      );
    throw error;
  }
}
