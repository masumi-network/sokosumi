import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  gatewayJevEvaluator,
  isJevConfigured,
  jevRouteAvailable,
  resetJevProviderLatchForTests,
} from "./jev-client";
import type { SerializedJevRequest } from "./jev-request";

const MODEL = "typesafe-ai/jev";

const env = {
  FILES_JEV_ENABLED: true,
  FILES_RANKING_MODEL: MODEL,
  AI_GATEWAY_API_KEY: "test-gateway-key",
};

vi.mock("@/config/env", () => ({ getEnv: () => env }));

const request: SerializedJevRequest = {
  body: { rubric: "Rate how well…", query: "invoice", candidate: { id: "r1" } },
  serialized: '{"rubric":"Rate how well…"}',
  tokens: 40,
  digest: "digest",
};

/** A well-formed reply, with the rungs the caller asks for filled in. */
function reply(answers: Record<string, unknown>, overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      model: MODEL,
      answers,
      usage: { inputTokens: 40, outputTokens: 3 },
      providerMetadata: {
        gateway: { cost: "0.00012", generationId: "gen-1" },
      },
      ...overrides,
    }),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetJevProviderLatchForTests();
  env.FILES_JEV_ENABLED = true;
  env.AI_GATEWAY_API_KEY = "test-gateway-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

describe("the request it sends", () => {
  it("sends state as an object and questions as a keyed map of booleans", async () => {
    fetchMock.mockResolvedValue(
      reply({ directly_answers: true, partly_answers: true, mentions: true }),
    );

    await gatewayJevEvaluator.evaluate({ request, rubric: "relevance" });

    const body = sentBody();
    expect(body.model).toBe(MODEL);

    // An object, not the serialized string an earlier revision sent.
    expect(typeof body.state).toBe("object");
    expect(Array.isArray(body.state)).toBe(false);
    expect(body.state).toEqual(request.body);

    // A map keyed by question id, not an array of {name, type, choices}.
    expect(Array.isArray(body.questions)).toBe(false);
    expect(Object.keys(body.questions).sort()).toEqual([
      "directly_answers",
      "mentions",
      "partly_answers",
    ]);
    for (const question of Object.values<{ type: string }>(body.questions)) {
      expect(question.type).toBe("boolean");
    }
  });

  it("asks for retention on every call", async () => {
    fetchMock.mockResolvedValue(
      reply({ clearly_belongs: false, probably_belongs: false }),
    );

    await gatewayJevEvaluator.evaluate({ request, rubric: "belongs" });

    expect(sentBody().providerOptions.gateway).toEqual({
      zeroDataRetention: true,
      disallowPromptTraining: true,
    });
  });

  it("marks the supplied state as untrusted in every question", async () => {
    fetchMock.mockResolvedValue(
      reply({
        directly_answers: false,
        partly_answers: false,
        mentions: false,
      }),
    );

    await gatewayJevEvaluator.evaluate({ request, rubric: "relevance" });

    for (const question of Object.values<{ instructions: string }>(
      sentBody().questions,
    )) {
      expect(question.instructions).toContain("untrusted data");
    }
  });
});

describe("the ordinal it derives", () => {
  it.each([
    [{ directly_answers: true, partly_answers: true, mentions: true }, 3],
    [{ directly_answers: false, partly_answers: true, mentions: true }, 2],
    [{ directly_answers: false, partly_answers: false, mentions: true }, 1],
    [{ directly_answers: false, partly_answers: false, mentions: false }, 0],
  ])("reads %o as %i", async (answers, expected) => {
    fetchMock.mockResolvedValue(reply(answers));

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.score).toBe(expected);
  });

  it("takes the highest true rung even when a lower one disagrees", async () => {
    // A model may answer "directly answers" without conceding "mentions".
    fetchMock.mockResolvedValue(
      reply({ directly_answers: true, partly_answers: false, mentions: false }),
    );

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.score).toBe(3);
  });

  it("refuses a partial answer rather than scoring it low", async () => {
    fetchMock.mockResolvedValue(reply({ directly_answers: true }));

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.score).toBeNull();
    expect(outcome.reason).toBe("invalid-answers");
  });

  it("refuses non-boolean answers", async () => {
    fetchMock.mockResolvedValue(
      reply({ directly_answers: "yes", partly_answers: true, mentions: true }),
    );

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.reason).toBe("invalid-answers");
  });
});

describe("what it reports back", () => {
  it("carries usage, cost and the generation id from the Gateway", async () => {
    fetchMock.mockResolvedValue(
      reply({ directly_answers: true, partly_answers: true, mentions: true }),
    );

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.inputTokens).toBe(40);
    expect(outcome.outputTokens).toBe(3);
    expect(outcome.costUsd).toBe("0.00012");
    expect(outcome.generationId).toBe("gen-1");
  });

  it("rejects a reply that is missing usage", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        model: MODEL,
        answers: {
          directly_answers: true,
          partly_answers: true,
          mentions: true,
        },
        providerMetadata: { gateway: {} },
      }),
    } as unknown as Response);

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.reason).toBe("invalid-response");
  });

  it("rejects a reply from a different model", async () => {
    fetchMock.mockResolvedValue(
      reply(
        { directly_answers: true, partly_answers: true, mentions: true },
        { model: "someone-else/model" },
      ),
    );

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.reason).toBe("model-mismatch");
  });

  it("reports status only, never a body that could echo the document", async () => {
    const json = vi.fn();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json,
    } as unknown as Response);

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.reason).toBe("status-503");
    expect(json).not.toHaveBeenCalled();
  });
});

describe("failing closed on the retention request", () => {
  it.each([400, 422])(
    "latches off after a %i and never retries without the options",
    async (status) => {
      fetchMock.mockResolvedValue({ ok: false, status } as unknown as Response);

      const first = await gatewayJevEvaluator.evaluate({
        request,
        rubric: "relevance",
      });
      expect(first.reason).toBe("provider-options-rejected");

      // The whole feature reports unconfigured from here on.
      expect(isJevConfigured()).toBe(false);

      const second = await gatewayJevEvaluator.evaluate({
        request,
        rubric: "relevance",
      });
      expect(second.reason).toBe("provider-options-rejected");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not latch on a transient server error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    await gatewayJevEvaluator.evaluate({ request, rubric: "relevance" });

    expect(isJevConfigured()).toBe(true);
  });
});

describe("the availability probe", () => {
  it("accepts the configured model when the catalog lists it", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "other/model" }, { id: MODEL }] }),
    } as unknown as Response);

    await expect(jevRouteAvailable()).resolves.toBe(true);
  });

  it("does not read the catalog's retention flags", async () => {
    // The public catalog omits the zero-retention route, so a `has_zdr: false`
    // there must not veto a model the Gateway can enforce per request.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: MODEL, has_zdr: false }] }),
    } as unknown as Response);

    await expect(jevRouteAvailable()).resolves.toBe(true);
  });

  it("rejects when the model is absent", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "other/model" }] }),
    } as unknown as Response);

    await expect(jevRouteAvailable()).resolves.toBe(false);
  });

  it("does not call out at all when the feature is off", async () => {
    env.FILES_JEV_ENABLED = false;

    await expect(jevRouteAvailable()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
