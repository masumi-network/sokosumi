import { findJsonObjectEnd } from "@sokosumi/utils";

const REASONING_GENERIC_LABELS = new Set([
  "Processing...",
  "Thinking...",
  "Searching files...",
  "Calling tools...",
]);

function extractThoughtFromJsonObject(raw: string): string | null {
  const candidate = raw
    .trim()
    .replace(/^\d+(?=\s*\{)/, "")
    .trimStart();
  if (!candidate.startsWith("{")) {
    return null;
  }

  const jsonEnd = findJsonObjectEnd(candidate, 0);
  if (jsonEnd === -1 || candidate.slice(jsonEnd).trim() !== "") {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const thought = (parsed as Record<string, unknown>).thought;
    return typeof thought === "string" && thought.trim()
      ? thought.trim()
      : null;
  } catch {
    return null;
  }
}

export function isReasoningGenericLabel(message: string): boolean {
  return REASONING_GENERIC_LABELS.has(message) || message.trim() === "";
}

export function getReasoningStepDisplayText(raw: string): string | null {
  const s = raw.trim();
  if (isReasoningGenericLabel(s)) {
    return null;
  }
  const thought = extractThoughtFromJsonObject(s);
  if (thought) {
    return thought;
  }
  return s;
}
