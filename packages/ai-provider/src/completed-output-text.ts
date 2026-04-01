/**
 * Extract assistant text from a completed Responses-style `output` payload.
 */
export function extractTextFromCompletedOutput(output: unknown): string {
  if (!Array.isArray(output) || output.length === 0) {
    return "";
  }
  const parts: string[] = [];
  for (const item of output) {
    const msg = item as { type?: string; content?: unknown[] };
    if (msg.type !== "message" || !Array.isArray(msg.content)) {
      continue;
    }
    for (const c of msg.content) {
      const part = c as { type?: string; text?: string };
      if (part.type === "output_text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("");
}
