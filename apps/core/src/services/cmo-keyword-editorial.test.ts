import { describe, expect, it, vi } from "vitest";
import type { KeywordIdea } from "@/lib/ads/dataforseo";
import { nativeKeywordReceipt } from "@/lib/ads/native-keyword-ideas";
import {
  askCmoEditor,
  cmoEditorialChoices,
  EDITORS,
  type EditorialRun,
} from "./cmo-keyword-editorial";

const fake = vi.hoisted(() => ({ generate: vi.fn(), generation: vi.fn() }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: fake.generate,
}));
vi.mock("@/lib/ai-gateway-purpose", () => ({
  aiGateway: () =>
    Object.assign((model: string) => model, {
      getGenerationInfo: fake.generation,
    }),
}));

const query = { topic: "salon", locationCode: 2250, languageCode: "fr" };
const row = (
  keyword: string,
  searchVolume: number | null = 80,
  difficulty: number | null = 20,
): KeywordIdea => ({
  keyword,
  searchVolume,
  difficulty,
  intent: "informational",
  cpc: null,
});
const run = (
  model: EditorialRun["model"],
  phrases: string[],
): EditorialRun => ({
  model,
  phrases,
  status: "ok",
  costUsd: 0.01,
  generationId: null,
});

describe("CMO editorial research", () => {
  it("orders independent lists, rejects unmeasured and difficult phrases, and continues past its first three", () => {
    const rows = [
      row("déjà testé"),
      row("étagère"),
      row("meuble"),
      row("banc"),
      row("fenêtre", 200, 60),
      row("mur", 0),
      row("porte", null),
      row("chaise"),
    ];
    const result = cmoEditorialChoices(
      [
        run(EDITORS[0], ["Déjà testé", "fenêtre", "mur", "étagère", "chaise"]),
        run(EDITORS[1], ["non mesuré", "porte", "meuble", "Étagère", "banc"]),
      ],
      rows,
      new Set(["déjà testé"]),
    );
    expect(result.map((i) => i.keyword)).toEqual([
      "étagère",
      "meuble",
      "chaise",
      "banc",
    ]);
  });

  it("publishes five independently ordered, measured phrases across two batches", () => {
    const terms = ["table", "rangement", "meuble", "banc", "chaise"];
    const rows = terms.map((term) => row(term));
    const accepted = cmoEditorialChoices(
      [
        run(EDITORS[0], [terms[0], terms[2], terms[4]]),
        run(EDITORS[1], [terms[1], terms[3]]),
      ],
      rows,
      new Set(),
    );
    expect(accepted.map((i) => i.keyword)).toEqual(terms);
  });

  it("native market conflicts, duplicates and billed vendor refusals never validate guesses", () => {
    const data = { keyword: "salon", location_code: 2250, language_code: "fr" };
    const result = [
      {
        items: [
          { keyword: "banc" },
          { keyword: "table", location_code: 2276 },
          { keyword: "chaise" },
          { keyword: "chaise", language_code: "en" },
        ],
      },
    ];
    const tasks = [{ id: "t1", cost: 0.02, status_code: 20000, data, result }];
    expect(nativeKeywordReceipt({ status_code: 20000, tasks }, query)).toEqual({
      costUsd: 0.02,
      taskId: "t1",
      exactKeywords: ["banc"],
    });
    expect(
      nativeKeywordReceipt(
        { status_code: 20000, tasks: [{ ...tasks[0], status_code: 50000 }] },
        query,
      ),
    ).toEqual({ costUsd: 0.02, taskId: "t1", exactKeywords: [] });
    expect(nativeKeywordReceipt({}, query)).toEqual({
      costUsd: null,
      taskId: null,
      exactKeywords: [],
    });
  });

  it("preserves a malformed model answer's price and uses a matched Gateway receipt when metadata lacks a price", async () => {
    const input = {
      ...query,
      businessName: "Mobilier",
      asOf: "2026-11-15",
      countryCode: "FR",
    };
    fake.generate.mockResolvedValueOnce({
      response: { id: "gen_bad" },
      providerMetadata: { gateway: { cost: "0.021" } },
      text: "invalid json",
    });
    const bad = await askCmoEditor(EDITORS[0], input);
    expect(bad).toMatchObject({
      costUsd: 0.021,
      status: "failed",
      phrases: [],
    });
    fake.generate.mockResolvedValueOnce({
      response: { id: "gen_good" },
      text: '{"phrases":["table basse"]}',
    });
    fake.generation.mockResolvedValueOnce({
      id: "gen_good",
      model: EDITORS[1],
      totalCost: 0.013,
      isByok: false,
    });
    expect(await askCmoEditor(EDITORS[1], input)).toMatchObject({
      costUsd: 0.013,
      status: "ok",
      phrases: ["table basse"],
    });
    expect(
      fake.generate.mock.calls.map(([v]) => [v.model, v.maxRetries]),
    ).toEqual([
      [EDITORS[0], 0],
      [EDITORS[1], 0],
    ]);
  });
  it("recovers the price and ID of a rejected paid generation from its receipt", async () => {
    fake.generate.mockRejectedValueOnce({
      providerMetadata: { gateway: { generationId: "gen_refusal" } },
    });
    fake.generation.mockResolvedValueOnce({
      id: "gen_refusal",
      model: EDITORS[0],
      isByok: false,
      totalCost: 0.009,
    });
    const result = await askCmoEditor(EDITORS[0], {
      topic: "étagère",
      countryCode: "FR",
      languageCode: "fr",
      businessName: "Mobilier",
      asOf: "2026-11-19",
    });
    expect(result).toMatchObject({
      status: "failed",
      costUsd: 0.009,
      generationId: "gen_refusal",
      phrases: [],
    });
    expect(fake.generation).toHaveBeenLastCalledWith({ id: "gen_refusal" });
  });
});
