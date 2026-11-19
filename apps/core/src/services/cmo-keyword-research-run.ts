import {
  fetchKeywordIdeas,
  fetchKeywordOverview,
  KEYWORD_IDEAS_LIMIT,
  type KeywordIdea,
} from "@/lib/ads/dataforseo";
import {
  keywordKey,
  type NativeKeywordReceipt,
} from "@/lib/ads/native-keyword-ideas";
import prisma from "@/lib/db/prisma";
import type { Cuso } from "./cmo-cuso.service";
import {
  askCmoEditor,
  cmoEditorialChoices,
  cmoRankedPhrases,
  EDITORIAL_BATCH_SIZE,
  EDITORS,
  type EditorialRun,
  eligibleCmoIdea,
  safeEditorialTopic,
} from "./cmo-keyword-editorial";
import {
  baselineOf,
  joinedMeasurements,
  newEvidence,
  priorOverviews,
  type StoredKeywordSearch,
} from "./cmo-keyword-evidence";
import {
  beginKeywordCharge,
  closeKeywordCharge,
} from "./cmo-keyword-purchases";

export async function researchKeywordRun(
  cuso: Cuso,
  runId: string,
  topic: string,
  rawTopic: string,
  market: { locationCode: number; countryCode: string; languageCode: string },
  now: Date,
  previous: StoredKeywordSearch | undefined,
  history: StoredKeywordSearch[],
) {
  const input = {
    topic,
    businessName: cuso.businessName,
    countryCode: market.countryCode,
    languageCode: market.languageCode,
    asOf: now.toISOString().slice(0, 10),
  };
  const canAsk = safeEditorialTopic(rawTopic, cuso.businessName);
  const excluded = new Set([keywordKey(topic)]);
  const open = await prisma.projectSeoSuggestion.findMany({
    where: {
      projectId: cuso.projectId,
      status: "open",
      keyword: { not: null },
    },
    select: { keyword: true },
  });
  for (const { keyword } of open)
    if (keyword) excluded.add(keywordKey(keyword));
  const ask = async () => {
    const attempts = await Promise.allSettled(
      EDITORS.map(async (model) => {
        const line = await beginKeywordCharge(
          cuso.projectId,
          runId,
          model,
          now,
        );
        const r = await askCmoEditor(model, input);
        await closeKeywordCharge(
          line.id,
          model,
          r.status,
          r.costUsd,
          r.generationId,
        );
        return r;
      }),
    );
    return attempts.map((a) => {
      if (a.status === "rejected") throw a.reason;
      return a.value;
    });
  };
  const baseline = baselineOf(previous, now);
  const measured = joinedMeasurements(
    previous ? [...history, previous] : history,
    now,
  );
  let runs: EditorialRun[] | undefined;
  let candidates: string[] = [];
  if (baseline && canAsk) {
    runs = await ask();
    candidates = cmoRankedPhrases(runs, excluded)
      .filter((k) => !measured.has(k))
      .slice(0, EDITORIAL_BATCH_SIZE);
  }
  const source = "dataforseo";
  const charge = await beginKeywordCharge(cuso.projectId, runId, source, now);
  const receipt: NativeKeywordReceipt = {
    costUsd: null,
    taskId: null,
    exactKeywords: [],
  };
  const observed = async (value: NativeKeywordReceipt) => {
    Object.assign(receipt, value);
    await closeKeywordCharge(
      charge.id,
      source,
      "ok",
      receipt.costUsd,
      receipt.taskId,
    );
  };
  let rows: KeywordIdea[];
  try {
    rows = candidates.length
      ? await fetchKeywordOverview({ ...market, topic }, candidates, observed)
      : await fetchKeywordIdeas({ ...market, topic }, observed);
  } catch (error) {
    await closeKeywordCharge(
      charge.id,
      source,
      "failed",
      receipt.costUsd,
      receipt.taskId,
    );
    throw error;
  }
  const native = newEvidence(
    candidates.length ? "overview" : "suggestions",
    now,
    receipt,
    rows,
  );
  for (const i of rows) measured.delete(keywordKey(i.keyword)); // A current unbound response cannot inherit an old measurement.
  for (const i of native.rows) measured.set(keywordKey(i.keyword), i);
  const pool = [...measured.values()];
  if (
    !runs &&
    canAsk &&
    pool.some((i) => eligibleCmoIdea(i) && !excluded.has(keywordKey(i.keyword)))
  )
    runs = await ask();
  const selected = cmoEditorialChoices(runs ?? [], pool, excluded).map((i) => ({
    ...i,
    editorial: true as const,
  }));
  const chosen = new Set(selected.map((i) => keywordKey(i.keyword)));
  const retainedBaseline = candidates.length ? baseline : native;
  const rest =
    candidates.length && baseline
      ? baseline.rows.map((i) => ({ ...i, measuredAt: baseline.measuredAt }))
      : rows;
  return {
    topic,
    countryCode: market.countryCode,
    languageCode: market.languageCode,
    baseline: retainedBaseline,
    priorOverviews: priorOverviews(previous, now),
    native,
    exactKeywords: receipt.exactKeywords,
    ideas: [
      ...selected,
      ...rest.filter((i) => !chosen.has(keywordKey(i.keyword))),
    ].slice(0, KEYWORD_IDEAS_LIMIT),
  };
}
