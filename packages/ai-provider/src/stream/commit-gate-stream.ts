import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

import {
  coworkerTextLooksLikeAgentError,
  MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS,
} from "../coworker-agent-error.js";

export type CommitGateRetryReason = "agent-error" | "short-tail";

export interface CommitGateOptions {
  onRetryNeeded: (
    reason: CommitGateRetryReason,
  ) => Promise<ReadableStream<LanguageModelV4StreamPart> | null>;
  minGoodChars?: number;
}

function coworkerStreamTextLooksSuspiciouslyShort(
  text: string,
  minGoodChars: number,
): boolean {
  if (coworkerTextLooksLikeAgentError(text)) {
    return false;
  }
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length < minGoodChars;
}

function canCommitStream(text: string, minGoodChars: number): boolean {
  if (coworkerTextLooksLikeAgentError(text)) {
    return false;
  }
  return text.length >= minGoodChars;
}

/**
 * Setup lifecycle held until first progress/commit so order is
 * stream-start → progress, without leaking setup on a discarded first attempt.
 *
 * `response-metadata` stays held until text **commit** (or end without retry)
 * so a failed attempt's response id is not flushed with early progress and then
 * doubled by a successful retry.
 */
function isHeldSetupLifecyclePart(part: LanguageModelV4StreamPart): boolean {
  return part.type === "stream-start" || part.type === "response-metadata";
}

/**
 * Progress parts that leave the gate before answer text commits.
 *
 * Room coworker `streamText` uses AI SDK `firstChunkMs` / `chunkMs`. Those
 * timers only reset on output chunks (non-empty reasoning-delta, tool-call,
 * tool-input-delta, text-delta). Coworkers may run tools for minutes while
 * only emitting reasoning heartbeats — if the gate buffers those, Sokosumi
 * aborts as stalled even though the upstream stream is alive.
 *
 * `error` also leaves early so mid-stream failures are not held until a late
 * text commit. Answer `text-*` and `finish` stay buffered for agent-error /
 * short-tail retries.
 */
function isProgressPassThroughPart(part: LanguageModelV4StreamPart): boolean {
  switch (part.type) {
    case "error":
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
      /** Answer-side parts held until commit (or discarded on successful retry). */
      const answerBuffer: LanguageModelV4StreamPart[] = [];
      /**
       * `stream-start` + `response-metadata` until flushed.
       * Progress flushes only `stream-start`; commit/end flushes the rest.
       */
      const setupBuffer: LanguageModelV4StreamPart[] = [];
      let textSoFar = "";
      let committed = false;
      /** At most one `stream-start` leaves the gate (retries must not re-emit). */
      let streamStartEmitted = false;

      function enqueue(part: LanguageModelV4StreamPart): void {
        if (part.type === "stream-start") {
          if (streamStartEmitted) {
            return;
          }
          streamStartEmitted = true;
        }
        controller.enqueue(part);
      }

      /** AI SDK protocol: stream-start before progress; keep response id until commit. */
      function flushStreamStartFromSetup(): void {
        const remaining: LanguageModelV4StreamPart[] = [];
        for (const part of setupBuffer) {
          if (part.type === "stream-start") {
            enqueue(part);
          } else {
            remaining.push(part);
          }
        }
        setupBuffer.length = 0;
        for (const part of remaining) {
          setupBuffer.push(part);
        }
      }

      function flushSetupBuffer(): void {
        for (const part of setupBuffer) {
          enqueue(part);
        }
        setupBuffer.length = 0;
      }

      function flushAnswerBuffer(): void {
        for (const part of answerBuffer) {
          enqueue(part);
        }
        answerBuffer.length = 0;
      }

      async function pipeRetryStream(
        source: ReadableStream<LanguageModelV4StreamPart>,
      ): Promise<void> {
        const reader = source.getReader();
        let completed = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              completed = true;
              break;
            }
            enqueue(value);
          }
        } finally {
          if (!completed) {
            try {
              await reader.cancel();
            } catch {
              // best-effort cancel of a failed retry pipe
            }
          }
          reader.releaseLock();
        }
      }

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
            flushSetupBuffer();
            flushAnswerBuffer();
            enqueue(value);
            continue;
          }

          if (committed) {
            enqueue(value);
          } else if (isHeldSetupLifecyclePart(value)) {
            setupBuffer.push(value);
          } else if (isProgressPassThroughPart(value)) {
            flushStreamStartFromSetup();
            enqueue(value);
          } else {
            answerBuffer.push(value);
          }
        }

        if (!committed) {
          let retryReason: CommitGateRetryReason | null = null;
          if (coworkerTextLooksLikeAgentError(textSoFar)) {
            retryReason = "agent-error";
          } else if (
            coworkerStreamTextLooksSuspiciouslyShort(textSoFar, minGoodChars)
          ) {
            retryReason = "short-tail";
          }

          if (retryReason) {
            const retryStream = await options.onRetryNeeded(retryReason);
            if (retryStream) {
              // Discard held setup + answer from the failed attempt. Progress
              // already enqueued may remain. Retry stream is filtered so a
              // second stream-start is not emitted; held response-metadata from
              // the failed attempt never left the gate.
              setupBuffer.length = 0;
              answerBuffer.length = 0;
              await pipeRetryStream(retryStream);
              controller.close();
              return;
            }
          }

          flushSetupBuffer();
          flushAnswerBuffer();
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
