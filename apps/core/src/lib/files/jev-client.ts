import { getEnv } from "@/config/env";
import type { SerializedJevRequest } from "@/lib/files/jev-request";

/**
 * The Jev transport.
 *
 * Jev is an evaluation model: it answers typed questions about supplied
 * state. It is not a chat model, so it does not go through
 * `@sokosumi/ai-provider` — forcing an evaluation through a streaming text
 * interface would mean parsing prose back into a score, which is exactly the
 * failure mode the typed surface exists to avoid.
 *
 * Every response is validated against the ids we sent and the score range we
 * asked for. Anything unexpected is a failure, and a failure means the
 * deterministic order stands.
 */

const GATEWAY_EVALUATE_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
const EVALUATION_TIMEOUT_MS = 2_000;

export const JEV_SCORE_MIN = 0;
export const JEV_SCORE_MAX = 3;

export interface JevEvaluationOutcome {
  ok: boolean;
  /** 0–3 ordinal relevance. Absent when the call failed or was invalid. */
  score: number | null;
  reason: string | null;
  latencyMs: number;
  inputTokens: number | null;
}

export function isJevConfigured(): boolean {
  const env = getEnv();
  return env.FILES_JEV_ENABLED && Boolean(env.AI_GATEWAY_API_KEY);
}

function parseScore(payload: unknown, questionName: string): number | null {
  if (!payload || typeof payload !== "object") return null;
  const results = (payload as Record<string, unknown>).results;
  if (!results || typeof results !== "object") return null;
  const answer = (results as Record<string, unknown>)[questionName];
  if (!answer || typeof answer !== "object") return null;

  const record = answer as Record<string, unknown>;
  const raw = record.choice ?? record.value ?? record.score;
  const numeric = typeof raw === "string" ? Number(raw) : raw;

  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;
  if (numeric < JEV_SCORE_MIN || numeric > JEV_SCORE_MAX) return null;
  return numeric;
}

function parseInputTokens(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return null;
  const tokens =
    (usage as Record<string, unknown>).inputTokens ??
    (usage as Record<string, unknown>).input_tokens;
  return typeof tokens === "number" && Number.isFinite(tokens) ? tokens : null;
}

export interface JevEvaluator {
  evaluate(input: {
    request: SerializedJevRequest;
    questionName: string;
    signal?: AbortSignal;
  }): Promise<JevEvaluationOutcome>;
}

export const gatewayJevEvaluator: JevEvaluator = {
  async evaluate(input) {
    const startedAt = Date.now();
    const env = getEnv();
    const apiKey = env.AI_GATEWAY_API_KEY;

    if (!apiKey) {
      return {
        ok: false,
        score: null,
        reason: "not-configured",
        latencyMs: 0,
        inputTokens: null,
      };
    }

    try {
      const response = await fetch(GATEWAY_EVALUATE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.FILES_RANKING_MODEL,
          state: input.request.serialized,
          questions: [
            {
              name: input.questionName,
              type: "choice",
              choices: ["0", "1", "2", "3"],
            },
          ],
        }),
        signal: input.signal ?? AbortSignal.timeout(EVALUATION_TIMEOUT_MS),
      });

      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        // Status only. A body can carry back the document text we sent.
        return {
          ok: false,
          score: null,
          reason: `status-${response.status}`,
          latencyMs,
          inputTokens: null,
        };
      }

      const payload: unknown = await response.json();
      const score = parseScore(payload, input.questionName);

      if (score === null) {
        return {
          ok: false,
          score: null,
          reason: "unparseable",
          latencyMs,
          inputTokens: parseInputTokens(payload),
        };
      }

      return {
        ok: true,
        score,
        reason: null,
        latencyMs,
        inputTokens: parseInputTokens(payload),
      };
    } catch (error) {
      return {
        ok: false,
        score: null,
        reason:
          error instanceof Error && error.name === "TimeoutError"
            ? "timeout"
            : "unreachable",
        latencyMs: Date.now() - startedAt,
        inputTokens: null,
      };
    }
  },
};
