import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  gatewayJevEvaluator,
  isJevConfigured,
  isJevProviderLatched,
  jevRouteAvailable,
  resetJevProviderLatchForTests,
} from "./jev-client";
import type { SerializedJevRequest } from "./jev-request";

const MODEL = "typesafe-ai/jev";

const env = {
  FILES_JEV_ENABLED: true,
  AI_GATEWAY_API_KEY: "test-gateway-key",
  INSTANCE_ID: "instance-7",
  // Deliberately present and wrong: the model must come from the pinned
  // literal, not from anything a deployment can set.
  FILES_RANKING_MODEL: "someone-else/model",
};

vi.mock("@/config/env", () => ({ getEnv: () => env }));

const { captureMessageMock } = vi.hoisted(() => ({
  captureMessageMock: vi.fn(),
}));
vi.mock("@sentry/node", () => ({ captureMessage: captureMessageMock }));

const request: SerializedJevRequest = {
  body: { rubric: "Rate how well…", query: "invoice", candidate: { id: "r1" } },
  serialized: '{"rubric":"Rate how well…"}',
  tokens: 40,
  digest: "digest",
};

/** A well-formed reply, with the rungs the caller asks for filled in. */
/**
 * Shape a boolean answer the way the provider actually returns one.
 *
 * `{type: "boolean", probability}` — an object carrying a float, not a raw
 * boolean. Confirmed four ways: the `EvaluationAnswer` type in `ai@7.0.114`,
 * main's shipped `task-tags.ts` answer schema, the HTTP example in the
 * Gateway docs, and TypeSafe's own `noul` primitive underneath.
 *
 * The previous helper passed raw booleans straight through, so every test in
 * this file asserted that our parser could read our own mock. It could. The
 * provider's real answers it rejected as malformed.
 */
function booleanAnswers(
  answers: Record<string, boolean | number>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(answers).map(([id, value]) => [
      id,
      {
        type: "boolean",
        probability: typeof value === "number" ? value : value ? 0.97 : 0.02,
      },
    ]),
  );
}

/** A reply whose `answers` are passed through exactly as given. */
function rawReply(answers: Record<string, unknown>, overrides = {}) {
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

function reply(answers: Record<string, boolean | number>, overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      model: MODEL,
      answers: booleanAnswers(answers),
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
  captureMessageMock.mockClear();
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
      reply({ directly_answers: false, mentions: false, on_topic: false }),
    );

    await gatewayJevEvaluator.evaluate({ request, rubric: "relevance" });

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

describe("the model it addresses", () => {
  it("sends the pinned literal, never a value from the environment", async () => {
    fetchMock.mockResolvedValue(
      reply({ directly_answers: true, partly_answers: true, mentions: true }),
    );

    await gatewayJevEvaluator.evaluate({ request, rubric: "relevance" });

    // `env.FILES_RANKING_MODEL` is set to another model above. A free-form
    // env string used to decide this, so a typo in a deployment's config
    // would have sent document text to whatever it named.
    expect(sentBody().model).toBe(MODEL);
    expect(sentBody().model).not.toBe(env.FILES_RANKING_MODEL);
  });

  it("rejects a reply that came back from a different model", async () => {
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

  it.each([
    [{ directly_answers: true, partly_answers: false, mentions: false }],
    [{ directly_answers: true, partly_answers: true, mentions: false }],
    [{ directly_answers: false, partly_answers: true, mentions: false }],
  ])("refuses the self-contradictory set %o", async (answers) => {
    // The rungs are nested claims: directly answering implies mentioning.
    // An answer set that breaks that is not a confident 3, it is a reply we
    // cannot trust. This test previously asserted the opposite — that the
    // highest true rung wins regardless — which is what made the ladder fail
    // open.
    fetchMock.mockResolvedValue(reply(answers));

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.score).toBeNull();
    // A distinct reason, not "invalid-answers": the reply parsed fine, it
    // just disagreed with itself.
    expect(outcome.reason).toBe("contradictory-answers");
  });

  it("still accepts a properly nested set", async () => {
    fetchMock.mockResolvedValue(
      reply({ directly_answers: false, partly_answers: true, mentions: true }),
    );

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.score).toBe(2);
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

  it("refuses a malformed answer at the schema", async () => {
    fetchMock.mockResolvedValue(
      rawReply({
        directly_answers: { type: "boolean", probability: "yes" },
        partly_answers: { type: "boolean", probability: 0.9 },
        mentions: { type: "boolean", probability: 0.9 },
      }),
    );

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    // The whole payload fails validation, which is a different and more
    // honest answer than "the answers were unreadable": we never got a
    // response we could read at all.
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("invalid-response");
  });

  it("refuses a raw boolean, which is the shape we used to expect", async () => {
    // This is the regression that mattered. The parser checked
    // `typeof record[id] !== "boolean"`, so it accepted exactly this and
    // rejected everything the provider really sends. A schema that still
    // accepts it would be the old bug wearing new clothes.
    fetchMock.mockResolvedValue(
      rawReply({
        directly_answers: true,
        partly_answers: true,
        mentions: true,
      }),
    );

    const outcome = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("invalid-response");
  });

  it("thresholds a rung's probability rather than trusting a bare yes", async () => {
    // 0.49 and 0.51 straddle `RUNG_TRUE_PROBABILITY`. Under the old parser
    // neither was readable at all; under the new one the number decides.
    fetchMock.mockResolvedValue(
      reply({ directly_answers: 0.2, partly_answers: 0.51, mentions: 0.99 }),
    );
    const middling = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });
    expect(middling.ok).toBe(true);
    expect(middling.score).toBe(2);

    fetchMock.mockResolvedValue(
      reply({ directly_answers: 0.2, partly_answers: 0.49, mentions: 0.99 }),
    );
    const below = await gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
    });
    expect(below.ok).toBe(true);
    expect(below.score).toBe(1);
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
      expect(isJevProviderLatched()).toBe(true);
    },
  );

  it("reports the latch once, naming the instance", async () => {
    // The latch is per-process: on a multi-instance deployment one instance
    // can go quiet while its siblings keep calling, and nothing else would
    // surface that the feature is half-dead.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
    } as unknown as Response);

    await gatewayJevEvaluator.evaluate({ request, rubric: "relevance" });
    await gatewayJevEvaluator.evaluate({ request, rubric: "relevance" });

    expect(isJevProviderLatched()).toBe(true);
    // Once, not once per refused call.
    expect(captureMessageMock).toHaveBeenCalledTimes(1);

    const [message, context] = captureMessageMock.mock.calls[0];
    expect(message).toContain("latched off");
    expect(context.level).toBe("error");
    expect(context.extra.instanceId).toBe("instance-7");
    expect(context.extra.status).toBe(400);
  });

  it("separates being latched from being switched off", async () => {
    expect(isJevProviderLatched()).toBe(false);
    env.FILES_JEV_ENABLED = false;
    // Disabled, but not latched: a caller explaining a deterministic
    // ordering needs to tell those two apart.
    expect(isJevConfigured()).toBe(false);
    expect(isJevProviderLatched()).toBe(false);
  });

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

describe("the signal it honours", () => {
  it("composes a caller's signal with its own timeout rather than replacing it", async () => {
    // `signal ?? timeout` removed the only bound on the fetch for any caller
    // that passed one. Nothing did yet, so nothing was broken — and the
    // first caller to pass a request-abort signal would have removed it
    // silently. P2-11 added exactly such a caller.
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );

    const controller = new AbortController();
    const pending = gatewayJevEvaluator.evaluate({
      request,
      rubric: "relevance",
      signal: controller.signal,
    });
    controller.abort();

    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    // The caller's abort reached the fetch, so the composed signal is live.
    expect(outcome.reason).toBe("unreachable");
  });
});

describe("asking about many labels at once", () => {
  function labels() {
    return [
      { id: "label-1", name: "Commuting", description: "About commuting" },
      { id: "label-2", name: "Cycling", description: null },
    ];
  }

  /** Real answer objects, same as `booleanAnswers` above. */
  function labelReply(answers: Record<string, boolean | number>) {
    return {
      ok: true,
      json: async () => ({
        model: MODEL,
        answers: booleanAnswers(answers),
        usage: { inputTokens: 40, outputTokens: 3 },
        providerMetadata: { gateway: {} },
      }),
    } as unknown as Response;
  }

  /** `answers` exactly as given, for the malformed cases. */
  function rawLabelReply(answers: Record<string, unknown>) {
    return {
      ok: true,
      json: async () => ({
        model: MODEL,
        answers,
        usage: { inputTokens: 40, outputTokens: 3 },
        providerMetadata: { gateway: {} },
      }),
    } as unknown as Response;
  }

  it("sends one question per label in one request", async () => {
    fetchMock.mockResolvedValue(
      labelReply({ "label-1": true, "label-2": false }),
    );

    const verdict = await gatewayJevEvaluator.evaluateLabels({
      request,
      labels: labels(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(sentBody().questions).sort()).toEqual([
      "label-1",
      "label-2",
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.chosen).toEqual(["label-1"]);
  });

  it("names the label in its question so the model knows what it is judging", async () => {
    fetchMock.mockResolvedValue(
      labelReply({ "label-1": false, "label-2": false }),
    );

    await gatewayJevEvaluator.evaluateLabels({ request, labels: labels() });

    const questions = sentBody().questions;
    expect(questions["label-1"].instructions).toContain("Commuting");
    expect(questions["label-1"].instructions).toContain("About commuting");
    expect(questions["label-1"].instructions).toContain("untrusted data");
    // Asked at the confident end: this replaces the old score-3 rung.
    expect(questions["label-1"].instructions).toContain("clearly belong");
  });

  it("refuses a reply that skipped a label rather than reading it as no", async () => {
    fetchMock.mockResolvedValue(labelReply({ "label-1": true }));

    const verdict = await gatewayJevEvaluator.evaluateLabels({
      request,
      labels: labels(),
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.chosen).toEqual([]);
    expect(verdict.reason).toBe("invalid-answers");
  });

  it("suggests only labels above the probability gate", async () => {
    // `LABEL_MIN_PROBABILITY` is 0.85, matching main's shipped classifier —
    // the only production evidence anyone has about where this model's
    // probabilities land. A suggestion is a proposal shown to a reader about
    // their own document, so it is a precision decision.
    fetchMock.mockResolvedValue(
      labelReply({ "label-1": 0.86, "label-2": 0.84 }),
    );

    const verdict = await gatewayJevEvaluator.evaluateLabels({
      request,
      labels: labels(),
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.chosen).toEqual(["label-1"]);
  });

  it("refuses a raw boolean label answer", async () => {
    // The old shape, refused at the schema rather than silently accepted.
    fetchMock.mockResolvedValue(
      rawLabelReply({ "label-1": true, "label-2": false }),
    );

    const verdict = await gatewayJevEvaluator.evaluateLabels({
      request,
      labels: labels(),
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("invalid-response");
  });

  it("still asks for retention, and still fails closed", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
    } as unknown as Response);

    const verdict = await gatewayJevEvaluator.evaluateLabels({
      request,
      labels: labels(),
    });

    expect(verdict.reason).toBe("provider-options-rejected");
    expect(isJevProviderLatched()).toBe(true);
  });
});
