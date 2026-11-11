/**
 * A turn may start with parts: independent briefs the runtime runs side by
 * side, each as its own model loop with the turn's system prompt and tools,
 * before the turn's own message. Their answers (hand-overs) are added to that
 * message, so the turn stays one turn: one foreground run, one settle. Cuso's
 * first read is the one user (SOKD-167); every other turn has none.
 */
export interface TurnPart {
  key: string;
  title: string;
  message: string;
  /**
   * The only tools the part is offered, among the turn's: a part researches
   * and saves, it never posts or reports while the others still run.
   */
  tools: readonly string[];
}

/** The turn's tools a part may use. */
export function partTools<T>(
  tools: Record<string, T>,
  part: Pick<TurnPart, "tools">,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => part.tools.includes(name)),
  );
}

/** A part is a short brief; it hands over well before the turn's cap. */
export const TURN_PART_MAX_STEPS = 12;

/** A part running longer is stopped; the turn goes on without it. */
export const TURN_PART_MAX_MS = 5 * 60 * 1_000;

/**
 * Runs every part at once and returns the turn's message with their
 * hand-overs, in the parts' order. A failed part is said so, never fatal:
 * the turn's own message covers what it left open.
 */
export async function withPartHandOvers(
  message: string,
  parts: readonly TurnPart[],
  run: (part: TurnPart) => Promise<string>,
): Promise<string> {
  if (parts.length === 0) return message;
  // A part that fails (a Gateway hiccup when six start at once) gets one
  // more try before its group falls back to the turn.
  const results = await Promise.allSettled(
    parts.map((part) => run(part).catch(() => run(part))),
  );
  const handOvers = parts.map((part, index) => {
    const result = results[index];
    const body =
      result?.status === "fulfilled"
        ? result.value.trim() || "This part handed nothing over."
        : `This part failed before its hand-over (${
            result?.reason instanceof Error ? result.reason.message : "failed"
          }).`;
    return `### ${part.title}\n${body}`;
  });
  return [
    message,
    "",
    "## Hand-overs",
    "These parts ran side by side in this turn, before this message. Each saved its own sections; this is what each found.",
    "",
    handOvers.join("\n\n"),
  ].join("\n");
}

/**
 * A tool may end its turn by returning `{ endTurn: message }`, bare or as a
 * read's `{ result }`: the step that called it is the turn's last, and the
 * message is its answer, so the model writes no closing step.
 */
export function toolEndedTurn(
  steps: readonly { toolResults: readonly { output: unknown }[] }[],
): string | undefined {
  for (const { output } of steps.at(-1)?.toolResults ?? []) {
    const value = (output as { result?: unknown } | null)?.result ?? output;
    const message = (value as { endTurn?: unknown } | null)?.endTurn;
    if (typeof message === "string" && message.trim())
      return JSON.stringify({
        kind: "REPORT",
        message: message.trim(),
        question: null,
        observationToolCallIds: [],
      });
  }
  return undefined;
}

/** A `stopWhen` condition: the last step's tool ended the turn. */
export const endedByTool = ({
  steps,
}: {
  steps: readonly { toolResults: readonly { output: unknown }[] }[];
}): boolean => toolEndedTurn(steps) !== undefined;
