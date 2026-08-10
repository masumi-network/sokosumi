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
   */
  maxRetries?: number;
  minGoodChars?: number;
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
  attempt = 0,
): Promise<LanguageModelV4StreamResult> {
  const maxRetries = options.maxRetries ?? COWORKER_CONVERSATION_MAX_RETRIES;
  const minGoodChars =
    options.minGoodChars ?? MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS;
  const result = await openStream();

  if (attempt >= maxRetries) {
    return result;
  }

  return {
    ...result,
    stream: createCommitGateStream(result.stream, {
      minGoodChars,
      onRetryNeeded: async () => {
        const nextAttempt = attempt + 1;
        if (nextAttempt > maxRetries) {
          return null;
        }
        const retryResult = await withConversationCommitPolicy(
          openStream,
          options,
          nextAttempt,
        );
        return retryResult.stream;
      },
    }),
  };
}
