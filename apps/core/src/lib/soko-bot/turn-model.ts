import type { SokoBotVersion, TurnClassification } from "@sokosumi/soko-bot";
import {
  cmoStrategyStepTurn,
  STRATEGY_TURN_PREFIX,
} from "@/services/marketing-strategy.service";

/**
 * Why a turn runs on the model it does. Stored on the turn beside `modelId`.
 * `default` is the version's own model; every other reason is its stronger
 * one.
 */
export type TurnModelReason =
  | "default"
  | "strategy"
  | "background_run"
  | "orchestration"
  | "complex"
  | "complex_thread";

const STRONG_REASONS: ReadonlySet<string> = new Set<TurnModelReason>([
  "orchestration",
  "complex",
  "complex_thread",
]);

/**
 * Jev's COMPLEX share at or above which a chat turn goes up. Calibrated on
 * 120 hand-labelled production chat turns (2026-11-21): with the rules
 * below, 73% of complex turns go up, and 2 of 43 simple ones.
 */
export const MIN_COMPLEX_PROBABILITY = 0.5;
/** A follow-up this soon after a strong turn may be the same conversation. */
export const COMPLEX_THREAD_WINDOW_MS = 30 * 60_000;
/**
 * …when Jev reads it as pointing back at it. Without this, an unrelated
 * question minutes after a complex one stayed up (7 of 18 eval cases).
 */
export const MIN_REFERS_TO_EARLIER = 0.7;

export interface TurnModelInput {
  version: Pick<SokoBotVersion, "model" | "strongModel">;
  clientTurnId: string;
  /** Core wrote the turn's route itself: a rhythm, a sync or a CMO step. */
  preset: boolean;
  /** Set for a run another turn started (`start_background_run`, CMO production). */
  background: boolean;
  classification: Pick<TurnClassification, "route" | "complexity" | "signals">;
  /** The bot's last foreground chat turn for the same person, if any. */
  previous: { modelReason: string | null; createdAt: Date } | null;
  now: Date;
}

/**
 * Picks the turn's model once, at its start: every step of a turn runs on
 * it, so the prompt cache holds. Routines (dreaming, stand-ups, mail deltas,
 * CMO production and its review) stay on the version's model.
 */
export function chooseTurnModel(input: TurnModelInput): {
  model: string;
  reason: TurnModelReason;
} {
  const strong = input.version.strongModel;
  const reason = strong ? strongReason(input) : null;
  return reason && strong
    ? { model: strong, reason }
    : { model: input.version.model, reason: "default" };
}

/** Runs a bot started itself with `start_background_run`. */
export const BACKGROUND_RUN_CLIENT_TURN_PREFIX = "background:";

function strongReason(input: TurnModelInput): TurnModelReason | null {
  // cmo-v25: Core's step writes on the strong model; the turn only calls it.
  if (cmoStrategyStepTurn(input.clientTurnId)) return null;
  // Every strategy turn: a plan, a patch, a Brand Brain fix or a finish round
  // (owner, 2026-11-21). Sol passed all 11 strategy cases, Luna 7.
  if (input.clientTurnId.startsWith(STRATEGY_TURN_PREFIX)) return "strategy";
  if (
    input.background &&
    input.clientTurnId.startsWith(BACKGROUND_RUN_CLIENT_TURN_PREFIX)
  )
    return "background_run";
  if (input.preset) return null;
  const { route, complexity } = input.classification;
  if (route === "HIRE_AGENT" || route === "MIXED") return "orchestration";
  if ((complexity?.probabilities.COMPLEX ?? 0) >= MIN_COMPLEX_PROBABILITY)
    return "complex";
  // Stay up while the conversation is complex; drop back on a message Jev
  // reads as simple or as a new subject.
  const previous = input.previous;
  if (
    complexity &&
    complexity.label !== "SIMPLE" &&
    (input.classification.signals?.refersToEarlier ?? 0) >=
      MIN_REFERS_TO_EARLIER &&
    previous?.modelReason &&
    STRONG_REASONS.has(previous.modelReason) &&
    input.now.getTime() - previous.createdAt.getTime() <=
      COMPLEX_THREAD_WINDOW_MS
  )
    return "complex_thread";
  return null;
}

/**
 * The model a started turn runs on: the one chosen at its start, if it is
 * still one of its version's. Turns from before routing have none stored.
 */
export function turnRunModel(
  version: Pick<SokoBotVersion, "model" | "strongModel">,
  modelId: string | null | undefined,
): string {
  return modelId && modelId === version.strongModel ? modelId : version.model;
}
