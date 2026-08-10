import type { LanguageModelV4StreamResult } from "@ai-sdk/provider";

import { MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS } from "../coworker-agent-error.js";
import { createCommitGateStream } from "./commit-gate-stream.js";

/** Max retry attempts after the first conversation stream (total opens = max + 1). */
export const COWORKER_CONVERSATION_MAX_RETRIES = 2;

export interface ConversationCommitPolicyOptions {
  /**
   * How many times to re-open the protocol stream after a failed commit-gate
   * (agent-error or short-tail). Default: {@link COWORKER_CONVERSATION_MAX_RETRIES}.
   * Pass `0` to skip the gate (single protocol open, no retries).
   * Non-finite (`NaN` / `±Infinity`), negative, and fractional values are
   * normalized to a non-negative integer (`0` when invalid).
   */
  maxRetries?: number;
  minGoodChars?: number;
}

/**
 * Floor non-negative retry budget. Non-finite / negative → 0 so
 * `attempt >= maxRetries` still terminates.
 */
function normalizeMaxRetries(value: number | undefined): number {
  const raw = value ?? COWORKER_CONVERSATION_MAX_RETRIES;
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.trunc(raw));
}

/**
 * Conversation product policy around a protocol stream factory.
 *
 * Protocol (`openStream`) stays mapping/fetch only. This wrapper applies the
 * commit-gate and re-opens the protocol stream on agent-error / short-tail
 * until `maxRetries` is exhausted (final attempt is ungated).
 */
export async function withConversationCommitPolicy(
  openStream: () => Promise<LanguageModelV4StreamResult>,
  options: ConversationCommitPolicyOptions = {},
): Promise<LanguageModelV4StreamResult> {
  return withConversationCommitPolicyAttempt(openStream, options, 0);
}

async function withConversationCommitPolicyAttempt(
  openStream: () => Promise<LanguageModelV4StreamResult>,
  options: ConversationCommitPolicyOptions,
  attempt: number,
): Promise<LanguageModelV4StreamResult> {
  const maxRetries = normalizeMaxRetries(options.maxRetries);
  const minGoodChars =
    options.minGoodChars ?? MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS;
  const result = await openStream();

  // Final attempt is ungated (no further onRetryNeeded).
  if (attempt >= maxRetries) {
    return result;
  }

  return {
    ...result,
    stream: createCommitGateStream(result.stream, {
      minGoodChars,
      onRetryNeeded: async () => {
        const retryResult = await withConversationCommitPolicyAttempt(
          openStream,
          options,
          attempt + 1,
        );
        return retryResult.stream;
      },
    }),
  };
}
