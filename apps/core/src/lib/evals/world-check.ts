import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

/**
 * Benchmark world validation (B2): an owner journey runs through the real
 * runner and Core with no model at all. The agent is a script, Jev answers
 * from the script, and nothing else may ask a model. `noop` answers every
 * turn "OK" with no tools; `reference` plays the step's scripted tool calls
 * through the same tool path as the model's.
 */
export type WorldCheckMode = "noop" | "reference";

export function worldCheckMode(
  env: NodeJS.ProcessEnv = process.env,
): WorldCheckMode | null {
  // Local benchmark runs only: a deployment never runs a turn on a script.
  if (env.VERCEL || env.NODE_ENV === "production") return null;
  const mode = env.OWNERBENCH_WORLD_CHECK;
  return mode === "noop" || mode === "reference" ? mode : null;
}

export interface ScriptedToolCall {
  tool: string;
  input: Record<string, unknown>;
}

/**
 * One scripted model step: tool calls to make, or the turn's answer. It sees
 * every tool result of the turn so far, oldest first, so a later call can
 * use an id an earlier one returned, and the turn, to look up the world's
 * own ids (a project, an account, a seeded file) as a fixture does.
 */
export type ScriptedStep = (
  results: readonly unknown[],
  turn: { turnId: string },
) => Promise<ScriptedToolCall[] | string> | ScriptedToolCall[] | string;

/** What Jev decides for the turn's route; the rest of its answers are neutral. */
export interface ScriptedRoute {
  route: string;
  writeScope?: string;
  complexity?: string;
}

export interface TurnScript {
  /** Picks the turn: text its message contains. */
  match: string;
  route?: ScriptedRoute;
  steps: readonly ScriptedStep[];
}

/** A journey's reference run: its turns' scripts, and Jev answers it needs. */
export interface ReferenceScript {
  turns: readonly TurnScript[];
  /**
   * Answers to other Jev questions, by question key: a yes-or-no's
   * probability, or a choice's option. Unlisted ones stay neutral.
   */
  jev?: Record<string, number | string>;
}

let pendingAudit: ((turnId: string) => Promise<void>) | null = null;

/**
 * Runs once, at the journey's first agent step: after the runner's reset and
 * setup, before the agent acts, which is where leftovers would show.
 */
export function auditBeforeFirstStep(
  audit: (turnId: string) => Promise<void>,
): void {
  pendingAudit = audit;
}

const scriptErrors: string[] = [];

/** The script steps that threw since the last call, once each (the SDK retries a step). */
export function takeScriptErrors(): string[] {
  return [...new Set(scriptErrors.splice(0))];
}

const NOOP_ANSWER = "OK";
let reference: ReferenceScript = { turns: [] };

/** The journey's reference script; the driver sets it per journey. */
export function setReferenceScript(next: ReferenceScript): void {
  reference = next;
}

function scriptFor(message: string): TurnScript | null {
  if (worldCheckMode() !== "reference") return null;
  // A message can quote the conversation before it: the turn is the script
  // whose text comes last, the newest message.
  let best: TurnScript | null = null;
  let at = -1;
  for (const turn of reference.turns) {
    const index = message.lastIndexOf(turn.match);
    if (index > at) [best, at] = [turn, index];
  }
  return best;
}

function toolResults(prompt: unknown): unknown[] {
  const results: unknown[] = [];
  for (const message of prompt as { role: string; content: unknown }[]) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content as {
      type: string;
      output?: { value?: unknown };
    }[])
      if (part.type === "tool-result") results.push(parsed(part.output?.value));
  }
  return results;
}

/** The tool's own result: Core wraps it with its evidence id for the model. */
function parsed(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return parsed(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (value && typeof value === "object" && "evidenceToolCallId" in value)
    return parsed((value as { result?: unknown }).result);
  return value;
}

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/**
 * The agent for one turn. Each model step plays the script's next step; past
 * the last one (a bounce, a wrap-up) it answers again with the last answer.
 */
export function worldCheckModel(
  message: string,
  turnId: string,
): MockLanguageModelV3 {
  const script = scriptFor(message);
  let step = 0;
  let lastAnswer = NOOP_ANSWER;
  let callId = 0;
  return new MockLanguageModelV3({
    doStream: async (options) => {
      const audit = pendingAudit;
      pendingAudit = null;
      await audit?.(turnId);
      const next = script?.steps[step];
      step += 1;
      let played: ScriptedToolCall[] | string;
      try {
        played = next
          ? await next(toolResults(options.prompt), { turnId })
          : lastAnswer;
      } catch (error) {
        // The runner would cover a failed step with a wrap-up answer; the
        // driver reads these so the run counts as invalid, never as a pass.
        scriptErrors.push(
          `step ${step - 1} of "${script?.match}": ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
      if (typeof played === "string") {
        lastAnswer = played;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "answer" },
              { type: "text-delta" as const, id: "answer", delta: played },
              { type: "text-end" as const, id: "answer" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: "stop" },
                usage: USAGE,
              },
            ],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            ...played.map((call) => ({
              type: "tool-call" as const,
              toolCallId: `world-check-${(callId += 1)}`,
              toolName: call.tool,
              input: JSON.stringify(call.input),
            })),
            {
              type: "finish" as const,
              finishReason: {
                unified: "tool-calls" as const,
                raw: "tool_calls",
              },
              usage: USAGE,
            },
          ],
        }),
      };
    },
  });
}

type Question =
  | { type: "boolean"; instructions?: string }
  | { type: "choice"; criteria: Record<string, string> };

function choice(options: Record<string, string>, picked: string | undefined) {
  const keys = Object.keys(options);
  const chosen = picked && keys.includes(picked) ? picked : keys[0]!;
  return {
    choice: chosen,
    probabilities: Object.fromEntries(
      keys.map((key) => [key, key === chosen ? 1 : 0]),
    ),
  };
}

/**
 * Jev's answers with no model. A route question takes the script's route
 * (a reply with no tools without one); every other question gets the
 * neutral answer: "no" for a yes-or-no, the first option for a choice.
 */
export function worldCheckJevAnswers(
  message: string,
  questions: Record<string, Question>,
): Record<string, unknown> {
  const route = scriptFor(message)?.route;
  const overrides =
    worldCheckMode() === "reference" ? (reference.jev ?? {}) : {};
  const picks: Record<string, number | string | undefined> = {
    ...overrides,
    route: route?.route ?? "DIRECT_RESPONSE",
    writeScope: route?.writeScope,
    complexity: route?.complexity ?? "SIMPLE",
  };
  return Object.fromEntries(
    Object.entries(questions).map(([key, question]) => {
      const pick = picks[key];
      return [
        key,
        question.type === "choice"
          ? choice(
              question.criteria,
              typeof pick === "string" ? pick : undefined,
            )
          : { probability: typeof pick === "number" ? pick : 0 },
      ];
    }),
  );
}

/** A model call nothing in a world check may make. */
export class WorldCheckModelCallError extends Error {
  constructor(what: string) {
    super(`World check: ${what} asked a model`);
    this.name = "WorldCheckModelCallError";
  }
}
