import type { LanguageModelV4StreamResult } from "@ai-sdk/provider";

import { MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS } from "../coworker-agent-error.js";
import { createCommitGateStream } from "./commit-gate-stream.js";

/** Max retry attempts after the first conversation stream (total opens = max + 1). */
export const COWORKER_CONVERSATION_MAX_RETRIES = 2;

/**
 * Conversation product policy around a protocol stream factory.
 *
 * Protocol (`openStream`) stays mapping/fetch only. This wrapper applies the
 * commit-gate and re-opens the protocol stream on agent-error / short-tail
 * until `maxRetries` is exhausted (final attempt is ungated).
 */
export async function withConversationCommitPolicy(
  openStream: () => Promise<LanguageModelV4StreamResult>,
): Promise<LanguageModelV4StreamResult> {
  return withConversationCommitPolicyAttempt(openStream, 0);
}

async function withConversationCommitPolicyAttempt(
  openStream: () => Promise<LanguageModelV4StreamResult>,
  attempt: number,
): Promise<LanguageModelV4StreamResult> {
  const result = await openStream();

  // Final attempt is ungated (no further onRetryNeeded).
  if (attempt >= COWORKER_CONVERSATION_MAX_RETRIES) {
    return result;
  }

  return {
    ...result,
    stream: createCommitGateStream(result.stream, {
      minGoodChars: MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS,
      onRetryNeeded: async () => {
        const retryResult = await withConversationCommitPolicyAttempt(
          openStream,
          attempt + 1,
        );
        return retryResult.stream;
      },
    }),
  };
}
