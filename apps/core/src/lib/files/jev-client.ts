import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";

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
 * to it. What it does guarantee is that a call is never retried without those
 * options: if the Gateway rejects the request as malformed, the evaluator
 * latches off for the life of the process rather than quietly downgrading to
 * a call with weaker retention.
 */

const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const EVALUATION_TIMEOUT_MS = 2_000;
const CATALOG_TIMEOUT_MS = 5_000;

export const JEV_SCORE_MIN = 0;
export const JEV_SCORE_MAX = 3;

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

/**
 * Set when the Gateway rejected a request that carried the retention
 * options. Nothing clears it: a process that cannot ask for zero retention
 * does not send document text at all.
 *
 * ## It is per-instance, and that is why it has to be loud
 *
 * This is process state. On a multi-instance deployment one instance can
 * latch off while its siblings keep calling, so the feature goes half-dead:
 * some searches rerank and some silently do not, and no aggregate metric
 * moves enough to notice. Whether it should ever reset is a separate
 * question; being able to see that it happened is not optional, so latching
 * reports itself once, with the instance it happened on.
 *
 * Two places already record it besides the report below. Every subsequent
 * evaluation returns `provider-options-rejected`, which
 * `recordJevDispatch` writes against the admission row, and the search
 * response carries it as `fallbackReason`, which the UI already shows as a
 * deterministic-order explanation.
 */
let providerOptionsRejected = false;

function latchProviderOptionsRejected(status: number): void {
  if (providerOptionsRejected) return;
  providerOptionsRejected = true;

  // `captureMessage` rather than a new counter: this is what the rest of
  // Core uses to say "something noteworthy that is not an exception".
  Sentry.captureMessage(
    "Files Jev evaluator latched off: the Gateway rejected the retention options",
    {
      level: "error",
      extra: {
        status,
        // Which instance, because the latch is per-process and its
        // siblings are probably still calling.
        instanceId: getEnv().INSTANCE_ID,
        model: FILES_RANKING_MODEL,
        consequence:
          "This instance will not send document text to Jev again until it restarts; Files falls back to deterministic ordering here.",
      },
    },
  );
}

export function isJevConfigured(): boolean {
  if (providerOptionsRejected) return false;
  const env = getEnv();
  return env.FILES_JEV_ENABLED && Boolean(env.AI_GATEWAY_API_KEY);
}

/**
 * Whether this instance has latched off, separately from whether the
 * feature is configured. A caller reporting why ranking was deterministic
 * needs to tell "switched off" apart from "refused by the provider".
 */
export function isJevProviderLatched(): boolean {
  return providerOptionsRejected;
}

/** Exposed for tests; production has no reason to clear the latch. */
export function resetJevProviderLatchForTests(): void {
  providerOptionsRejected = false;
}

const catalogSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

/**
 * Discover the route before paying for it.
 *
 * This deliberately does **not** read the catalog's aggregate retention
 * flags. The public catalog omits the TypeSafe zero-retention route, so those
 * flags would reject a route the Gateway can enforce per request — the same
 * reasoning the shipped task-tag probe records. Equally, a route appearing
 * here is not evidence that retention is honoured; it is only evidence that
 * the model id exists.
 */
export async function jevRouteAvailable(
  signal?: AbortSignal,
): Promise<boolean> {
  if (!isJevConfigured()) return false;

  const timeout = AbortSignal.timeout(CATALOG_TIMEOUT_MS);
  try {
    const response = await fetch(`${GATEWAY_BASE_URL}/models`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) return false;

    const parsed = catalogSchema.safeParse(await response.json());
    if (!parsed.success) return false;

    return parsed.data.data.some((entry) => entry.id === FILES_RANKING_MODEL);
  } catch {
    return false;
  }
}

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

const resultSchema = z.object({
  model: z.string(),
  answers: z.unknown(),
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
  answers: unknown,
  rungs: readonly RubricRung[],
): LadderReading {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { ok: false, reason: "invalid-answers" };
  }
  const record = answers as Record<string, unknown>;

  // Every rung must come back, and come back boolean. A partial reply is not
  // a low score — it is an answer we cannot place on the scale.
  for (const rung of rungs) {
    if (typeof record[rung.id] !== "boolean") {
      return { ok: false, reason: "invalid-answers" };
    }
  }

  const highestTrue = rungs.findIndex((rung) => record[rung.id] === true);
  if (highestTrue === -1) return { ok: true, score: JEV_SCORE_MIN };

  // Everything weaker than the claim it just made must hold too.
  for (const rung of rungs.slice(highestTrue + 1)) {
    if (record[rung.id] !== true) {
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

  if (providerOptionsRejected) {
    return {
      kind: "failed",
      reason: "provider-options-rejected",
      latencyMs: 0,
    };
  }
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
      if (response.status === 400 || response.status === 422) {
        latchProviderOptionsRejected(response.status);
        return {
          kind: "failed",
          reason: "provider-options-rejected",
          latencyMs,
        };
      }
      // Status only. A body can carry back the document text we sent.
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
    inputTokens: parsed.usage.inputTokens,
    outputTokens: parsed.usage.outputTokens,
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

    const record = answers as Record<string, unknown>;
    // Every label must come back, and come back boolean. A partial reply is
    // not "those labels are false" — it is an answer we cannot read.
    for (const label of input.labels) {
      if (typeof record[label.id] !== "boolean") {
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
        .filter((label) => record[label.id] === true)
        .map((label) => label.id),
      reason: null,
      latencyMs: result.latencyMs,
      ...metadata,
    };
  },
};
