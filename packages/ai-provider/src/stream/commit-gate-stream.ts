import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

import {
  COWORKER_AGENT_ERROR_SNIPPET,
  MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS,
} from "../coworker-agent-error.js";

export type CommitGateRetryReason = "agent-error" | "short-tail";

export interface CommitGateOptions {
  onRetryNeeded: (
    reason: CommitGateRetryReason,
  ) => Promise<ReadableStream<LanguageModelV3StreamPart> | null>;
  minGoodChars?: number;
}

function coworkerStreamTextLooksLikeAgentError(text: string): boolean {
  return text.includes(COWORKER_AGENT_ERROR_SNIPPET);
}

function coworkerStreamTextLooksSuspiciouslyShort(
  text: string,
  minGoodChars: number,
): boolean {
  if (coworkerStreamTextLooksLikeAgentError(text)) {
    return false;
  }
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length < minGoodChars;
}

async function pipeStreamToController(
  source: ReadableStream<LanguageModelV3StreamPart>,
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
): Promise<void> {
  const reader = source.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      controller.enqueue(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function canCommitStream(text: string, minGoodChars: number): boolean {
  if (coworkerStreamTextLooksLikeAgentError(text)) {
    return false;
  }
  return text.length >= minGoodChars;
}

export function createCommitGateStream(
  sourceStream: ReadableStream<LanguageModelV3StreamPart>,
  options: CommitGateOptions,
): ReadableStream<LanguageModelV3StreamPart> {
  const minGoodChars =
    options.minGoodChars ?? MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS;
  const sourceReader = sourceStream.getReader();

  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      const buffer: LanguageModelV3StreamPart[] = [];
      let textSoFar = "";
      let committed = false;

      try {
        while (true) {
          const { done, value } = await sourceReader.read();
          if (done) {
            break;
          }

          if (value.type === "text-delta") {
            textSoFar += value.delta;
          }

          if (!committed && canCommitStream(textSoFar, minGoodChars)) {
            committed = true;
            for (const bufferedPart of buffer) {
              controller.enqueue(bufferedPart);
            }
            buffer.length = 0;
            controller.enqueue(value);
            continue;
          }

          if (committed) {
            controller.enqueue(value);
          } else {
            buffer.push(value);
          }
        }

        if (!committed) {
          let retryReason: CommitGateRetryReason | null = null;
          if (coworkerStreamTextLooksLikeAgentError(textSoFar)) {
            retryReason = "agent-error";
          } else if (
            coworkerStreamTextLooksSuspiciouslyShort(textSoFar, minGoodChars)
          ) {
            retryReason = "short-tail";
          }

          if (retryReason) {
            const retryStream = await options.onRetryNeeded(retryReason);
            if (retryStream) {
              await pipeStreamToController(retryStream, controller);
              controller.close();
              return;
            }
          }

          for (const bufferedPart of buffer) {
            controller.enqueue(bufferedPart);
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        sourceReader.releaseLock();
      }
    },
  });
}
