import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_TAG_IDS } from "@/helpers/task-tags";
import {
  classifyTaskTags,
  JEV_TASK_TAG_MODEL,
  taskTagProviderAvailable,
} from "./task-tag-classifier";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
const fetchMock = vi.fn<typeof fetch>();
const signal = new AbortController().signal;
function evaluation() {
  return {
    model: JEV_TASK_TAG_MODEL,
    answers: Object.fromEntries(
      TASK_TAG_IDS.map((id) => [
        id,
        { type: "boolean", probability: id === "research" ? 0.95 : 0.5 },
      ]),
    ),
    usage: { inputTokens: 12, outputTokens: 8 },
    providerMetadata: {
      gateway: { cost: "0.00012", generationId: "gen-test" },
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  getEnvMock.mockReturnValue({
    TASK_TAG_CLASSIFICATION_ENABLED: true,
    AI_GATEWAY_API_KEY: "test-key",
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("task tag provider capability", () => {
  it.each([
    { TASK_TAG_CLASSIFICATION_ENABLED: false, AI_GATEWAY_API_KEY: "test-key" },
    { TASK_TAG_CLASSIFICATION_ENABLED: true },
  ])(
    "does not contact any provider without enabled configuration: %j",
    async (env) => {
      getEnvMock.mockReturnValue(env);
      expect(await taskTagProviderAvailable(signal)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { data: [] },
    { data: [{ id: "other/model", regions: ["eu"], zdr: "all" }] },
  ])(
    "fails closed on unsupported catalog %j without content egress",
    async (catalog) => {
      fetchMock.mockResolvedValue(Response.json(catalog));
      expect(await taskTagProviderAvailable(signal)).toBe(false);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        "https://ai-gateway.vercel.sh/v1/models",
        { signal: expect.any(AbortSignal) },
      );
    },
  );
  it.each([{}, { zdr: "none", no_training: "all" }, { regions: ["us"] }])(
    "accepts a listed model without relying on incomplete catalog policy fields: %j",
    async (capabilities) => {
      fetchMock.mockResolvedValue(
        Response.json({
          data: [{ id: JEV_TASK_TAG_MODEL, ...capabilities }],
        }),
      );
      expect(await taskTagProviderAvailable(signal)).toBe(true);
    },
  );
  it("fails closed on a catalog HTTP error", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    expect(await taskTagProviderAvailable(signal)).toBe(false);
  });
});

describe("task tag evaluation", () => {
  it("bounds untrusted input, enforces ZDR/no-training globally, and preserves cost metadata", async () => {
    fetchMock.mockResolvedValue(Response.json(evaluation()));
    expect(
      await classifyTaskTags("T".repeat(500), "D".repeat(10_000), signal),
    ).toEqual({
      ok: true,
      tags: ["research"],
      usage: { inputTokens: 12, outputTokens: 8 },
      costUsd: "0.00012",
      generationId: "gen-test",
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/evaluate");
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      signal: expect.any(AbortSignal),
    });
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe(JEV_TASK_TAG_MODEL);
    expect(body.state).toEqual({
      title: "T".repeat(300),
      description: "D".repeat(8000),
    });
    expect(Object.keys(body.questions)).toEqual(TASK_TAG_IDS);
    expect(body.questions.research).toMatchObject({
      type: "boolean",
      instructions: expect.stringContaining("untrusted data"),
    });
    expect(body.providerOptions).toEqual({
      gateway: {
        zeroDataRetention: true,
        disallowPromptTraining: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("returns no tags for uncertainty and does not guess a category", async () => {
    const result = evaluation();
    result.answers.research!.probability = 0.84;
    fetchMock.mockResolvedValue(Response.json(result));
    expect(await classifyTaskTags("unclear", null, signal)).toMatchObject({
      ok: true,
      tags: [],
    });
  });
  it.each([400, 401, 429, 500])(
    "never falls back after HTTP %s",
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response("sensitive provider error", { status }),
      );
      expect(await classifyTaskTags("private title", null, signal)).toEqual({
        ok: false,
        reason: `http_${status}`,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { model: "fallback/model" },
    { usage: { inputTokens: -1, outputTokens: 1 } },
    { providerMetadata: { gateway: { cost: "secret" } } },
  ])("rejects malformed result metadata %j", async (override) => {
    fetchMock.mockResolvedValue(
      Response.json({ ...evaluation(), ...override }),
    );
    expect(await classifyTaskTags("task", null, signal)).toEqual({
      ok: false,
      reason: "invalid_response",
    });
  });
  it.each([
    {},
    { research: true },
    { research: { type: "boolean", probability: 1.2 } },
  ])("rejects malformed answers %j", async (answers) => {
    fetchMock.mockResolvedValue(Response.json({ ...evaluation(), answers }));
    expect(await classifyTaskTags("task", null, signal)).toEqual({
      ok: false,
      reason: "invalid_answers",
      usage: { inputTokens: 12, outputTokens: 8 },
      costUsd: "0.00012",
      generationId: "gen-test",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
