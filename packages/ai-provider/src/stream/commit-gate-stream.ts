import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

import {
  COWORKER_AGENT_ERROR_SNIPPET,
  MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS,
} from "../coworker-agent-error.js";

export type CommitGateRetryReason = "agent-error" | "short-tail";

export interface CommitGateOptions {
  onRetryNeeded: (
    reason: CommitGateRetryReason,
  ) => Promise<ReadableStream<LanguageModelV4StreamPart> | null>;
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
  source: ReadableStream<LanguageModelV4StreamPart>,
  controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
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

/**
 * Progress parts that must leave the gate before answer text commits.
 *
 * Room coworker `streamText` uses AI SDK `firstChunkMs` / `chunkMs`. Those
 * timers only reset on output chunks (non-empty reasoning-delta, tool-call,
 * tool-input-delta, text-delta). Coworkers may run tools for minutes while
 * only emitting reasoning heartbeats — if the gate buffers those, Sokosumi
 * aborts as stalled even though the upstream stream is alive.
 *
 * Answer `text-*` (and finish/lifecycle) stay buffered so agent-error and
 * short-tail retries still hide bad first attempts.
 */
function isProgressPassThroughPart(part: LanguageModelV4StreamPart): boolean {
  switch (part.type) {
    case "reasoning-start":
    case "reasoning-delta":
    case "reasoning-end":
    case "reasoning-file":
    case "tool-call":
    case "tool-input-start":
    case "tool-input-delta":
    case "tool-input-end":
      return true;
    default:
      return false;
  }
}

export function createCommitGateStream(
  sourceStream: ReadableStream<LanguageModelV4StreamPart>,
  options: CommitGateOptions,
): ReadableStream<LanguageModelV4StreamPart> {
  const minGoodChars =
    options.minGoodChars ?? MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS;
  const sourceReader = sourceStream.getReader();

  return new ReadableStream<LanguageModelV4StreamPart>({
    async start(controller) {
      const buffer: LanguageModelV4StreamPart[] = [];
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
          } else if (isProgressPassThroughPart(value)) {
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
              // Progress may already have been forwarded; retry only replaces
              // the buffered answer path (text/finish), not leaked reasoning.
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
