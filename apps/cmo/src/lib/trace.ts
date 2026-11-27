/** How Cuso got to a reply: the steps he took and the model's own summaries. */
export interface CusoTrace {
  steps: string[];
  thoughts: string[];
}

/**
 * The trace Core keeps on Cuso's reply (`metadata.reasoning`): a part with
 * kind "step" is a step, one without a kind is a reasoning summary, and
 * Core's own notes are left out. Null when there is nothing to show.
 */
export function traceOf(metadata: unknown): CusoTrace | null {
  const parts =
    metadata && typeof metadata === "object" && "reasoning" in metadata
      ? metadata.reasoning
      : null;
  if (!Array.isArray(parts)) return null;
  const trace: CusoTrace = { steps: [], thoughts: [] };
  for (const part of parts) {
    if (!part || typeof part !== "object" || typeof part.text !== "string") {
      continue;
    }
    const text = part.text.trim();
    if (!text) continue;
    if (part.kind === "step") {
      // The same step several times in a row reads as one.
      if (trace.steps.at(-1) !== text) trace.steps.push(text);
    } else if (part.kind === undefined) {
      // A summary keeps its own headings ("**Picking a look**").
      trace.thoughts.push(text);
    }
  }
  return trace.steps.length > 0 || trace.thoughts.length > 0 ? trace : null;
}
