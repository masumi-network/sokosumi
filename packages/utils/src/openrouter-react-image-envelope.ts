/** ReAct-style JSON envelope emitted for OpenRouter image generation. */
export const OPENROUTER_IMAGE_GENERATION_REACT_ACTION =
  "openrouter_image_generation";
export const DALLE_TEXT_TO_IMAGE_REACT_ACTION = "dalle.text2im";

const REACT_JSON_FENCE_PREFIX = "```json";
const IMAGE_GENERATION_REACT_ACTIONS = new Set<string>([
  OPENROUTER_IMAGE_GENERATION_REACT_ACTION,
  DALLE_TEXT_TO_IMAGE_REACT_ACTION,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function findJsonObjectEnd(text: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  return -1;
}

export function isReactJsonFencePrefixCandidate(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    REACT_JSON_FENCE_PREFIX.startsWith(lower) ||
    /^```json(?:$|[ \t\r\n])/.test(lower)
  );
}

/** O(n): removes trailing spaces/tabs on each segment ending at `\n` (ReDoS-safe). */
function stripSpacesAndTabsBeforeLineFeeds(value: string): string {
  const parts: string[] = [];
  let segmentStart = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "\n") {
      continue;
    }
    let end = i;
    while (
      end > segmentStart &&
      (value[end - 1] === " " || value[end - 1] === "\t")
    ) {
      end -= 1;
    }
    parts.push(value.slice(segmentStart, end), "\n");
    segmentStart = i + 1;
  }
  parts.push(value.slice(segmentStart));
  return parts.join("");
}

export function normalizeReactEnvelopeTrailingText(trailing: string): string {
  return stripSpacesAndTabsBeforeLineFeeds(trailing)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ParseReactEnvelopeBufferResult =
  | {
      status: "complete";
      isReactEnvelope: boolean;
      thought: string;
      trailing: string;
    }
  | { status: "incomplete" };

function parseReactEnvelopeJson(
  rawJson: string,
  trailing: string,
  outerFallback: string,
): ParseReactEnvelopeBufferResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    return {
      status: "complete",
      isReactEnvelope: false,
      thought: "",
      trailing: outerFallback,
    };
  }

  if (!isRecord(parsed)) {
    return {
      status: "complete",
      isReactEnvelope: false,
      thought: "",
      trailing: outerFallback,
    };
  }

  const isReactEnvelope =
    typeof parsed.action === "string" &&
    IMAGE_GENERATION_REACT_ACTIONS.has(parsed.action) &&
    "action_input" in parsed;

  if (!isReactEnvelope) {
    return {
      status: "complete",
      isReactEnvelope: false,
      thought: "",
      trailing: outerFallback,
    };
  }

  return {
    status: "complete",
    isReactEnvelope: true,
    thought: typeof parsed.thought === "string" ? parsed.thought.trim() : "",
    trailing,
  };
}

/**
 * Incremental parse of assistant text that may start with a ReAct image JSON
 * envelope (raw `{...}` or fenced ` ```json … ``` `). Used while SSE deltas
 * arrive; returns `"incomplete"` until the envelope and optional closing fence
 * can be decided.
 */
export function parseReactEnvelopeBuffer(
  buffer: string,
): ParseReactEnvelopeBufferResult {
  const firstNonWhitespaceIndex = buffer.search(/\S/);
  if (firstNonWhitespaceIndex === -1) {
    return { status: "incomplete" };
  }

  const leading = buffer.slice(firstNonWhitespaceIndex);
  if (isReactJsonFencePrefixCandidate(leading)) {
    const fenceMatch = /^```json[ \t]*(?:\r?\n|$|(?=\{))/i.exec(leading);
    if (!fenceMatch) {
      const openedJsonFence = /^```json[ \t]*/i.exec(leading);
      if (openedJsonFence) {
        const afterFenceTag = leading.slice(openedJsonFence[0].length);
        if (
          afterFenceTag.length > 0 &&
          !/^\r?\n/.test(afterFenceTag) &&
          afterFenceTag[0] !== "{"
        ) {
          return {
            status: "complete",
            isReactEnvelope: false,
            thought: "",
            trailing: buffer,
          };
        }
      }
      return { status: "incomplete" };
    }

    const jsonStart = firstNonWhitespaceIndex + fenceMatch[0].length;
    const closingFenceIndex = buffer.indexOf("```", jsonStart);
    if (closingFenceIndex === -1) {
      return { status: "incomplete" };
    }
    const rawJson = buffer.slice(jsonStart, closingFenceIndex).trim();
    const trailing = buffer.slice(closingFenceIndex + 3);
    return parseReactEnvelopeJson(rawJson, trailing, buffer);
  }

  if (buffer[firstNonWhitespaceIndex] !== "{") {
    return {
      status: "complete",
      isReactEnvelope: false,
      thought: "",
      trailing: buffer,
    };
  }

  const jsonEnd = findJsonObjectEnd(buffer, firstNonWhitespaceIndex);
  if (jsonEnd === -1) {
    return { status: "incomplete" };
  }

  const rawJson = buffer.slice(firstNonWhitespaceIndex, jsonEnd);
  const trailing = buffer.slice(jsonEnd);
  return parseReactEnvelopeJson(rawJson, trailing, buffer);
}

/**
 * Best-effort parse of full assistant text (e.g. on stream finish). Unlike
 * {@link parseReactEnvelopeBuffer}, incomplete input is treated as “no
 * envelope” and the original string is returned.
 */
export function extractReactEnvelope(text: string): {
  strippedText: string;
  thought: string | null;
  hadEnvelope: boolean;
} {
  const parsed = parseReactEnvelopeBuffer(text);
  if (parsed.status === "incomplete") {
    return { strippedText: text, thought: null, hadEnvelope: false };
  }
  if (!parsed.isReactEnvelope) {
    return {
      strippedText: parsed.trailing,
      thought: null,
      hadEnvelope: false,
    };
  }
  return {
    strippedText: normalizeReactEnvelopeTrailingText(parsed.trailing),
    thought: parsed.thought.trim() ? parsed.thought.trim() : null,
    hadEnvelope: true,
  };
}
