import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import { getSeoAnalysisExecution } from "@/lib/seo/analysis-executor-config";
import type { Cuso } from "@/services/cmo-cuso.service";
import { requestProjectSeoAnalysis } from "@/services/project-seo-operations.service";
import { cmoSeoActor, cmoSeoHomePage } from "./cmo-seo-audit.service";
import { cmoSeoMarket } from "./cmo-seo-market";

/** A position check the SEO specialist ran for these searches this recently is used again. */
const REUSE_MS = 24 * 60 * 60 * 1000;
const RESULTS_SHOWN = 5;

export type CmoRankingsCheck =
  | { status: "started" | "running"; analysisId: string }
  | { status: "done"; analysisId: string; outcome: string }
  | { status: "unavailable" | "busy" | "no_credits"; message: string };

const keywordSet = (keywords: string[]) =>
  [
    ...new Set(
      keywords.map((k) => k.trim().toLowerCase().replace(/\s+/g, " ")),
    ),
  ].sort();

function requestKeywords(request: unknown): string[] {
  const keywords = (request as { keywords?: unknown } | null)?.keywords;
  return Array.isArray(keywords)
    ? keywordSet(keywords.filter((k): k is string => typeof k === "string"))
    : [];
}

/**
 * Asks the SEO specialist (the SEO check service, through a Core-approved
 * rankings check on the brand's homepage, mobile) where the site ranks for up
 * to five searches. The same searches checked in the last day are not paid
 * for again: a running check is followed, a finished one is answered at once,
 * and a failed one runs again.
 */
export async function checkCmoSearchRankings(
  cuso: Cuso,
  rawKeywords: string[],
  now: Date = new Date(),
): Promise<CmoRankingsCheck> {
  const keywords = keywordSet(rawKeywords);
  const { enabled, executor } = getSeoAnalysisExecution();
  if (!enabled || !executor?.canUsePaidSearchData)
    return {
      status: "unavailable",
      message: "The SEO specialist is not available here right now.",
    };
  const recent = await prisma.projectSeoAnalysis.findMany({
    where: {
      projectId: cuso.projectId,
      kind: "rankings",
      createdAt: { gte: new Date(now.getTime() - REUSE_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, request: true, taskId: true },
  });
  const sameSearches = recent.filter(
    (row) => requestKeywords(row.request).join("|") === keywords.join("|"),
  );
  const stopped = await stoppedTaskIds(
    sameSearches.flatMap((row) => (row.taskId ? [row.taskId] : [])),
  );
  // A check that failed is neither followed nor answered: it runs again.
  const failed = sameSearches.filter(
    (row) => row.status === "failed" || (row.taskId && stopped.has(row.taskId)),
  );
  const same = sameSearches.find((row) => !failed.includes(row));
  if (same?.status === "completed") {
    const outcome = await seoCheckOutcome(same.id);
    if (outcome) return { status: "done", analysisId: same.id, outcome };
  }
  if (same) return { status: "running", analysisId: same.id };
  const actor = await cmoSeoActor(cuso);
  if (!actor)
    return {
      status: "unavailable",
      message: "Nobody in the business can be billed for the check.",
    };
  const page = await cmoSeoHomePage(cuso, actor);
  const market = await cmoSeoMarket(cuso);
  const day = now.toISOString().slice(0, 10);
  const idempotencyKey = `cmo-rankings:${createHash("sha256")
    // Each failed try gets a key of its own, or the failed row would answer.
    .update(
      `${day}|${keywords.join("|")}${failed.length > 0 ? `|retry-${failed.length}` : ""}`,
    )
    .digest("hex")
    .slice(0, 40)}`;
  try {
    await requestProjectSeoAnalysis(actor, {
      kind: "rankings",
      pageIds: [page.id],
      keywords,
      countryCode: market.countryCode,
      languageCode: market.languageCode,
      devices: ["mobile"],
      competitorUrls: [],
      maxProviderCalls: keywords.length,
      idempotencyKey,
    });
    const { id } = await prisma.projectSeoAnalysis.findUniqueOrThrow({
      where: {
        projectId_idempotencyKey: { projectId: cuso.projectId, idempotencyKey },
      },
      select: { id: true },
    });
    return { status: "started", analysisId: id };
  } catch (error) {
    if (!(error instanceof HTTPException)) throw error;
    if (error.status === 422 && /credits/i.test(error.message))
      return {
        status: "no_credits",
        message: `The check needs a few credits and the business is out of them: ${error.message}`,
      };
    if (error.status === 409)
      return {
        status: "busy",
        message:
          "The SEO specialist is busy with another check of this site (often the weekly audit). Answer from the latest audit and Search Console now, and offer to check again later.",
      };
    if (error.status < 500)
      return { status: "unavailable", message: error.message };
    throw error;
  }
}

/** The Tasks among these that failed or were canceled. */
async function stoppedTaskIds(taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, status: { in: ["FAILED", "CANCELED"] } },
    select: { id: true },
  });
  return new Set(tasks.map((task) => task.id));
}

/**
 * Where a position check stands, for the follow-up that answers the owner:
 * null while it runs, else what it found or why it failed.
 */
export async function seoCheckOutcome(
  analysisId: string,
): Promise<string | null> {
  const analysis = await prisma.projectSeoAnalysis.findUnique({
    where: { id: analysisId },
    select: { status: true, taskId: true, failureReason: true, request: true },
  });
  if (!analysis) return "The SEO check no longer exists.";
  const task = analysis.taskId
    ? await prisma.task.findUnique({
        where: { id: analysis.taskId },
        select: { status: true },
      })
    : null;
  if (
    analysis.status === "failed" ||
    task?.status === "FAILED" ||
    task?.status === "CANCELED"
  )
    return `The SEO specialist's check failed${analysis.failureReason ? `: ${analysis.failureReason}` : ""}. Nothing was charged for it.`;
  if (analysis.status !== "completed" || !analysis.taskId) return null;
  const observation = await prisma.projectSeoObservation.findFirst({
    where: { sourceTaskId: analysis.taskId, ownerId: null },
    orderBy: { observedAt: "desc" },
    select: { payload: true, observedAt: true },
  });
  const parsed = observation
    ? publicSeoPayloadSchema.safeParse(observation.payload)
    : null;
  if (!parsed?.success)
    return "The SEO specialist finished, but its result could not be read.";
  const date = observation!.observedAt.toISOString().slice(0, 10);
  const lines = requestKeywords(analysis.request).map((keyword) => {
    const row = parsed.data.keywords.find(
      (item) => item.keyword.trim().toLowerCase() === keyword,
    );
    const where =
      row?.position != null
        ? `position ${row.position}`
        : `not in the top ${row?.checkedResults ?? 10}`;
    const serp = parsed.data.serps?.find(
      (read) => read.keyword.trim().toLowerCase() === keyword,
    );
    const above = (serp?.top ?? [])
      .slice(0, RESULTS_SHOWN)
      .flatMap((result) =>
        result.domain ? [`${result.rank}. ${result.domain}`] : [],
      )
      .join("; ");
    return `- "${keyword}" (${row?.device ?? "mobile"}, ${parsed.data.countryCode}): ${where}${row?.volume != null ? `, ${row.volume} searches a month` : ""}${above ? `. Top results: ${above}` : ""}`;
  });
  return [
    `The SEO specialist checked Google on ${date} for ${parsed.data.pageUrls[0]}:`,
    ...lines,
  ].join("\n");
}
