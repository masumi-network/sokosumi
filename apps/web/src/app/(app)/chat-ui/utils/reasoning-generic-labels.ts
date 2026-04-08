const REASONING_GENERIC_LABELS = new Set([
  "Processing...",
  "Thinking...",
  "Searching files...",
  "Calling tools...",
]);

const GENERIC_STATUS_PREFIXES: string[] = [
  "Processing...",
  "Thinking...",
  "Searching files...",
  "Calling tools...",
];

export function isReasoningGenericLabel(message: string): boolean {
  return REASONING_GENERIC_LABELS.has(message) || message.trim() === "";
}

export function getReasoningStepDisplayText(raw: string): string | null {
  let s = raw.trim();
  if (!s) {
    return null;
  }
  if (isReasoningGenericLabel(s)) {
    return null;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of GENERIC_STATUS_PREFIXES) {
      if (s.startsWith(prefix)) {
        s = s.slice(prefix.length).trimStart();
        changed = true;
      }
    }
  }
  if (!s || isReasoningGenericLabel(s)) {
    return null;
  }
  return s;
}
