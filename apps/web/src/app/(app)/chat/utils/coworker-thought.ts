import { isChatUiProviderReasoningPartType } from "@sokosumi/utils";

export interface CoworkerThoughtDisclosure {
  text: string;
  /** Whole seconds; null when timing unknown or invalid. */
  durationSeconds: number | null;
}

export interface CoworkerThoughtViewModel {
  /** Latest Thought text for the live stream overlay (no answer yet). */
  liveBeat: string | null;
  /** Post-answer / durable disclosure; null when no Thought. */
  disclosure: CoworkerThoughtDisclosure | null;
  /** Stream overlay with no answer and no Thought yet → static Thinking... */
  showThinkingFallback: boolean;
}

function readPartText(part: Record<string, unknown>): string {
  if ("text" in part && part.text != null) {
    return String(part.text).trim();
  }
  if ("content" in part && part.content != null) {
    return String(part.content).trim();
  }
  return "";
}

function collectReasoningTexts(parts: unknown): string[] {
  if (!Array.isArray(parts)) {
    return [];
  }
  const chunks: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const record = part as Record<string, unknown>;
    if (!isChatUiProviderReasoningPartType(record.type)) {
      continue;
    }
    const text = readPartText(record);
    if (text) {
      chunks.push(text);
    }
  }
  return chunks;
}

/** Join non-empty provider reasoning parts from a UIMessage-style parts array. */
export function extractThoughtTextFromMessageParts(parts: unknown): string {
  return collectReasoningTexts(parts).join("\n\n");
}

/** Latest non-empty reasoning part only (live stream beat). */
export function extractLatestThoughtBeatFromMessageParts(
  parts: unknown,
): string {
  const chunks = collectReasoningTexts(parts);
  return chunks.length > 0 ? chunks[chunks.length - 1]! : "";
}

function reasoningStepsFromMetadata(metadata: unknown): unknown[] {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }
  const reasoning = (metadata as Record<string, unknown>).reasoning;
  return Array.isArray(reasoning) ? reasoning : [];
}

/** Join Thought from Core-persisted `metadata.reasoning` steps. */
export function extractThoughtTextFromMetadata(metadata: unknown): string {
  return collectReasoningTexts(reasoningStepsFromMetadata(metadata)).join(
    "\n\n",
  );
}

/** Latest non-empty step from `metadata.reasoning` (live stream beat). */
export function extractLatestThoughtBeatFromMetadata(
  metadata: unknown,
): string {
  const chunks = collectReasoningTexts(reasoningStepsFromMetadata(metadata));
  return chunks.length > 0 ? chunks[chunks.length - 1]! : "";
}

/**
 * Duration from `metadata.thought_timing_ms` (`start` / `end` epoch ms).
 * Null when missing, start ≤ 0, or end < start.
 */
export function extractThoughtDurationSeconds(
  metadata: unknown,
): number | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const timing = (metadata as Record<string, unknown>).thought_timing_ms;
  if (!timing || typeof timing !== "object") {
    return null;
  }
  const rec = timing as Record<string, unknown>;
  const start = typeof rec.start === "number" ? rec.start : Number.NaN;
  const end = typeof rec.end === "number" ? rec.end : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  if (start <= 0 || end < start) {
    return null;
  }
  return Math.max(0, Math.round((end - start) / 1000));
}

export function resolveCoworkerThoughtViewModel(input: {
  content: string;
  isStreamOverlay: boolean;
  metadata?: unknown;
  /** Optional live UIMessage parts when metadata not yet filled. */
  parts?: unknown;
}): CoworkerThoughtViewModel {
  const answer = input.content.trim();
  const thoughtTextFull =
    extractThoughtTextFromMetadata(input.metadata) ||
    extractThoughtTextFromMessageParts(input.parts ?? null);
  const liveBeatText =
    extractLatestThoughtBeatFromMetadata(input.metadata) ||
    extractLatestThoughtBeatFromMessageParts(input.parts ?? null);
  const durationSeconds = extractThoughtDurationSeconds(input.metadata);

  if (input.isStreamOverlay && answer.length === 0) {
    if (liveBeatText.length > 0) {
      return {
        liveBeat: liveBeatText,
        disclosure: null,
        showThinkingFallback: false,
      };
    }
    return {
      liveBeat: null,
      disclosure: null,
      showThinkingFallback: true,
    };
  }

  if (thoughtTextFull.length === 0) {
    return {
      liveBeat: null,
      disclosure: null,
      showThinkingFallback: false,
    };
  }

  return {
    liveBeat: null,
    disclosure: {
      text: thoughtTextFull,
      durationSeconds,
    },
    showThinkingFallback: false,
  };
}

/** Shape stored under room message metadata for reasoning steps. */
export function reasoningStepsForMetadata(
  parts: unknown,
): Array<{ type: string; text: string }> | undefined {
  if (!Array.isArray(parts)) {
    return undefined;
  }
  const out: Array<{ type: string; text: string }> = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const record = part as Record<string, unknown>;
    if (!isChatUiProviderReasoningPartType(record.type)) {
      continue;
    }
    const text = readPartText(record);
    if (!text) {
      continue;
    }
    const type =
      typeof record.type === "string" && record.type.trim()
        ? record.type.trim()
        : "reasoning";
    out.push({ type, text });
  }
  return out.length > 0 ? out : undefined;
}
