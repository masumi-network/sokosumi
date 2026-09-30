import { z } from "@hono/zod-openapi";

import { getEnv } from "@/config/env";
import type { SerializedJevRequest } from "@/lib/files/jev-request";
import {
  FILES_RANKING_MODEL,
  type JevRubricKey,
  labelQuestions,
  RUBRICS,
  type RubricRung,
} from "@/lib/files/jev-rubrics";

/**
 * The Jev transport.
 *
 * Jev is an evaluation model: it answers typed questions about supplied
 * state. It is not a chat model, so it does not go through
 * `@sokosumi/ai-provider` — forcing an evaluation through a streaming text
 * interface would mean parsing prose back into a score, which is exactly the
 * failure mode the typed surface exists to avoid.
 *
 * ## The contract is the one main already ships
 *
 * An earlier revision of this file was written against a *guessed* Gateway
 * contract: `state` as a JSON string, `questions` as an array of
 * `{name, type: "choice", choices}`, and a reply read out of
 * `results[name].choice`. Task-tag classification
 * (`clients/task-tag-classifier.ts`) has since shipped a working integration,
 * and it disagrees on every one of those points. This file now follows the
 * working one:
 *
 * - `state` is an **object**, not a serialized string.
 * - `questions` is an **object map** of `{id: {type, instructions}}`.
 * - the reply is `{model, answers, usage, providerMetadata}`, Zod-validated.
 * - `providerOptions.gateway` carries the retention request on every call.
 *
 * Only `type: "boolean"` is demonstrated by that working integration, so the
 * 0–3 relevance rubric is asked as a **ladder of booleans** rather than as an
 * unverified `choice` question. The ordinal the ranking stage consumes is
 * derived from the highest rung that came back true. If `choice` is later
 * confirmed against the official contract, the ladder collapses into one
 * question without changing any caller.
 *
 * ## Retention is requested, not verified
 *
 * Every call asks for `zeroDataRetention` and `disallowPromptTraining`. That
 * is a request to the Gateway, and this code does not treat a successful
 * response as proof that either was honoured — nothing in the reply attests
 * to it. What it does guarantee is that a call is never retried without
 * those options: there is no code path that builds a request without them,
 * so a rejection cannot be answered by quietly downgrading.
 *
 * ## There is no provider latch any more
 *
 * A 400 or a 422 used to latch the evaluator off for the life of the
 * process, on the theory that the Gateway was rejecting the retention
 * options. It discriminates on `error.type`, not on status, so that
 * inference was wrong in both directions: a 400 for any other reason
 * killed ranking on the instance until it restarted, and a 413 — the
 * status an oversized request actually gets — did not fire it at all.
 *
 * One bad request could therefore take an instance's ranking out
 * permanently, with siblings still serving, so the feature went half dead
 * and no aggregate moved enough to notice. The scheduler's circuit breaker
 * is the real protection here and it half-opens by itself, which a latch
 * with nothing to clear it never did.
 */

const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const EVALUATION_TIMEOUT_MS = 2_000;

export const JEV_SCORE_MIN = 0;

export interface JevEvaluationOutcome {
  ok: boolean;
  /** 0–3 ordinal relevance. Absent when the call failed or was invalid. */
  score: number | null;
  reason: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Gateway's own cost string, when it reports one. Never computed here. */
  costUsd: string | null;
  generationId: string | null;
}

export function isJevConfigured(): boolean {
  const env = getEnv();
  return env.FILES_JEV_ENABLED && Boolean(env.AI_GATEWAY_API_KEY);
}

/**
 * Token usage, which the provider may not report.
 *
 * The SDK's own type has both counts as `number | undefined`, and this schema
 * required non-negative integers — so a Gateway that omitted them would fail
 * the *whole* response and a successful evaluation would be recorded as a
 * provider failure.
 *
 * Missing maps to null, which is not a new convention: the outcome type these
 * feed is already `number | null`, and the daily spend cap already treats a
 * null cost as unknown rather than as free. Accepting *missing* usage is not
 * accepting nonsense usage — a negative count still fails.
 */
const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullish(),
    outputTokens: z.number().int().nonnegative().nullish(),
  })
  .nullish();

/**
 * What a `boolean` question actually answers with.
 *
 * **An object carrying a float, not a boolean.** The name is the Gateway's;
 * underneath it is TypeSafe's `noul` primitive, "probability of a yes
 * answer". Confirmed four independent ways: the `EvaluationAnswer` type in
 * `ai@7.0.114`, main's shipped `helpers/task-tags.ts` schema, the worked HTTP
 * example in the Gateway docs, and the vendor's own Python SDK.
 *
 * This file previously declared `answers: z.unknown()` and then checked
 * `typeof record[id] !== "boolean"` downstream. `answers` is the *only* part
 * of the payload that comes back from someone else, and it was the one part
 * nothing validated — so every real answer was rejected as malformed while
 * every mocked one passed. Validating it here is what closes that class:
 * nothing downstream can see an unchecked value, and a raw boolean now fails
 * at the boundary instead of being silently accepted.
 */
const booleanAnswerSchema = z.object({
  type: z.literal("boolean"),
  probability: z.number().finite().min(0).max(1),
});

export type JevBooleanAnswer = z.infer<typeof booleanAnswerSchema>;

const answersSchema = z.record(z.string(), booleanAnswerSchema);

/**
 * The probability at which a rung counts as answered yes.
 *
 * A rung is an ordinary yes/no claim, so the neutral reading of "probability
 * of a yes" is the right one: caution belongs in the rubric's wording and in
 * this one visible number, not in both. The rubric instructions used to add
 * "Answer false when unclear", which pushed the value down before we
 * thresholded it — the same caution counted twice.
 */
const RUNG_TRUE_PROBABILITY = 0.5;

/**
 * The probability at which a label is suggested.
 *
 * 0.85, matching main's shipped task-tag classifier, which has the only
 * production evidence anyone has about how this model's probabilities land.
 * A suggestion is shown to a reader as a proposal about their document, so it
 * is a precision decision, not a neutral one — and it is now the *only* gate
 * on that decision. `SUGGESTION_MIN_SCORE` used to sit beside it and stopped
 * gating anything when labelling became a single call; it is gone rather than
 * left for the next reader to trust.
 */
const LABEL_MIN_PROBABILITY = 0.85;

const resultSchema = z.object({
  model: z.string(),
  answers: answersSchema,
  usage: usageSchema,
  providerMetadata: z.object({
    gateway: z.object({
      cost: z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .optional(),
      generationId: z.string().max(200).optional(),
    }),
  }),
});

type LadderReading =
  | { ok: true; score: number }
  | { ok: false; reason: "invalid-answers" | "contradictory-answers" };

/**
 * Read the ladder, or refuse to.
 *
 * The rungs run high to low and each is a strictly weaker claim than the one
 * above it: a document that *directly answers* a query necessarily *mentions*
 * its subject. A consistent answer set is therefore monotone — once a rung is
 * true, every rung below it is true.
 *
 * An earlier version took the highest true rung and stopped, so
 * `{directly_answers: true, mentions: false}` — an answer set that
 * contradicts itself — scored the **maximum**. That is failing open: the
 * least trustworthy reply produced the most confident score.
 *
 * Both failures carry their own reason rather than collapsing to a low
 * score. A scoring bug that reads as "not very relevant" is nearly invisible
 * once it ships; an explicit failure shows up in the dispatch record and
 * falls back to the deterministic order, which is the honest answer.
 */
function readLadder(
  answers: Record<string, JevBooleanAnswer>,
  rungs: readonly RubricRung[],
): LadderReading {
  // Every rung must come back. A partial reply is not a low score — it is an
  // answer we cannot place on the scale. The *shape* of each answer is
  // already guaranteed by `answersSchema`; what is checked here is presence.
  for (const rung of rungs) {
    if (answers[rung.id] === undefined) {
      return { ok: false, reason: "invalid-answers" };
    }
  }

  const yes = (rung: RubricRung) =>
    answers[rung.id].probability >= RUNG_TRUE_PROBABILITY;

  const highestTrue = rungs.findIndex(yes);
  if (highestTrue === -1) return { ok: true, score: JEV_SCORE_MIN };

  // Everything weaker than the claim it just made must hold too.
  for (const rung of rungs.slice(highestTrue + 1)) {
    if (!yes(rung)) {
      return { ok: false, reason: "contradictory-answers" };
    }
  }

  return { ok: true, score: rungs[highestTrue].score };
}

export interface JevLabelVerdict {
  ok: boolean;
  /** Ids the model said the document clearly belongs to. */
  chosen: string[];
  reason: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  generationId: string | null;
}

export interface JevEvaluator {
  evaluate(input: {
    request: SerializedJevRequest;
    rubric: JevRubricKey;
    signal?: AbortSignal;
  }): Promise<JevEvaluationOutcome>;
}

/**
 * Asking about every candidate label in one request.
 *
 * Separate from `JevEvaluator` because the ranking path never does this, and
 * making its test stubs implement a method they never call buys nothing.
 *
 * One call per label meant up to 30 requests per document, each paying for
 * the same excerpt, each with its own admission row and reservation. One
 * boolean per label in a single request is the pattern the adopted contract
 * demonstrates.
 */
export interface JevLabelEvaluator {
  evaluateLabels(input: {
    request: SerializedJevRequest;
    labels: readonly { id: string; name: string; description: string | null }[];
    signal?: AbortSignal;
  }): Promise<JevLabelVerdict>;
}

function failure(
  reason: string,
  latencyMs: number,
  partial?: Partial<JevEvaluationOutcome>,
): JevEvaluationOutcome {
  return {
    ok: false,
    score: null,
    reason,
    latencyMs,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    generationId: null,
    ...partial,
  };
}

/** The one place a request body is built and sent. */
async function postEvaluation(input: {
  state: Record<string, unknown>;
  questions: Record<string, { type: "boolean"; instructions: string }>;
  signal?: AbortSignal;
}): Promise<
  | { kind: "ok"; parsed: z.infer<typeof resultSchema>; latencyMs: number }
  | { kind: "failed"; reason: string; latencyMs: number }
> {
  const startedAt = Date.now();
  const apiKey = getEnv().AI_GATEWAY_API_KEY;

  if (!apiKey)
    return { kind: "failed", reason: "not-configured", latencyMs: 0 };

  try {
    const timeout = AbortSignal.timeout(EVALUATION_TIMEOUT_MS);
    const response = await fetch(`${GATEWAY_BASE_URL}/evaluate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FILES_RANKING_MODEL,
        state: input.state,
        questions: input.questions,
        providerOptions: {
          gateway: {
            zeroDataRetention: true,
            disallowPromptTraining: true,
          },
        },
      }),
      // Compose rather than replace. `signal ?? timeout` removed the only
      // bound on the fetch for any caller that passed one; main composes,
      // and so does this.
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      /**
       * Status only, and the same answer for every status. A body can
       * carry back the document text we sent.
       *
       * 400 and 422 used to be singled out as "the Gateway rejected our
       * retention options" and latch the evaluator off. The Gateway
       * discriminates on `error.type`, so the status told us nothing of
       * the sort, and the reason string that went with it claimed
       * knowledge this code does not have.
       */
      return { kind: "failed", reason: `status-${response.status}`, latencyMs };
    }

    const parsed = resultSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { kind: "failed", reason: "invalid-response", latencyMs };
    }
    if (parsed.data.model !== FILES_RANKING_MODEL) {
      return { kind: "failed", reason: "model-mismatch", latencyMs };
    }
    return { kind: "ok", parsed: parsed.data, latencyMs };
  } catch (error) {
    return {
      kind: "failed",
      reason:
        error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "unreachable",
      latencyMs: Date.now() - startedAt,
    };
  }
}

function metadataOf(parsed: z.infer<typeof resultSchema>) {
  return {
    inputTokens: parsed.usage?.inputTokens ?? null,
    outputTokens: parsed.usage?.outputTokens ?? null,
    costUsd: parsed.providerMetadata.gateway.cost ?? null,
    generationId: parsed.providerMetadata.gateway.generationId ?? null,
  };
}

export const gatewayJevEvaluator: JevEvaluator & JevLabelEvaluator = {
  async evaluate(input) {
    const rungs = RUBRICS[input.rubric];
    const result = await postEvaluation({
      state: input.request.body,
      questions: Object.fromEntries(
        rungs.map((rung) => [
          rung.id,
          { type: "boolean" as const, instructions: rung.instructions },
        ]),
      ),
      signal: input.signal,
    });

    if (result.kind === "failed") {
      return failure(result.reason, result.latencyMs);
    }

    const metadata = metadataOf(result.parsed);
    const reading = readLadder(result.parsed.answers, rungs);
    if (!reading.ok) {
      return failure(reading.reason, result.latencyMs, metadata);
    }

    return {
      ok: true,
      score: reading.score,
      reason: null,
      latencyMs: result.latencyMs,
      ...metadata,
    };
  },

  async evaluateLabels(input) {
    const result = await postEvaluation({
      state: input.request.body,
      questions: labelQuestions(input.labels),
      signal: input.signal,
    });

    const empty = {
      chosen: [] as string[],
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      generationId: null,
    };

    if (result.kind === "failed") {
      return {
        ok: false,
        reason: result.reason,
        latencyMs: result.latencyMs,
        ...empty,
      };
    }

    const metadata = metadataOf(result.parsed);
    const answers = result.parsed.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return {
        ok: false,
        chosen: [],
        reason: "invalid-answers",
        latencyMs: result.latencyMs,
        ...metadata,
      };
    }

    const record = answers;
    // Every label must come back. A partial reply is not "those labels are
    // false" — it is an answer we cannot read.
    for (const label of input.labels) {
      if (record[label.id] === undefined) {
        return {
          ok: false,
          chosen: [],
          reason: "invalid-answers",
          latencyMs: result.latencyMs,
          ...metadata,
        };
      }
    }

    return {
      ok: true,
      chosen: input.labels
        .filter(
          (label) => record[label.id].probability >= LABEL_MIN_PROBABILITY,
        )
        .map((label) => label.id),
      reason: null,
      latencyMs: result.latencyMs,
      ...metadata,
    };
  },
};
