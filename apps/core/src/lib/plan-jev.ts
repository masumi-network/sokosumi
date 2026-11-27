import { AiGatewayBudgetError } from "@/lib/ai-gateway-budget";
import { recordCoreWarning } from "@/lib/evlog";
import {
  localChatGptPlanEnabled,
  planRealJevEnabled,
} from "@/lib/local-chatgpt-plan";

/**
 * Which Jev a ChatGPT plan run asks: real Jev through the Gateway (opt-in,
 * `SOKO_BOT_PLAN_REAL_JEV`) or the plan's stand-in. When real Jev fails often
 * (a Gateway budget stop, or more than a tenth of the recent calls), the run
 * keeps going on the stand-in for a while and then tries real Jev again; the
 * stand-in windows are recorded so results that used them can be labelled
 * and rerun.
 */
export type PlanJevMode = "real" | "stand-in";

const RECENT_CALLS = 50;
const MIN_CALLS_TO_JUDGE = 10;
const MAX_FAILURE_SHARE = 0.1;
export const PLAN_JEV_PAUSE_MS = 30 * 60_000;

const state = {
  recent: [] as boolean[],
  pausedUntil: null as number | null,
  standInWindows: [] as { from: number; to: number }[],
  calls: 0,
  failures: 0,
  costUsd: 0,
};

/** Real Jev, the stand-in, or null when this is not a plan run. */
export function planJevMode(now: number = Date.now()): PlanJevMode | null {
  if (!localChatGptPlanEnabled()) return null;
  if (!planRealJevEnabled()) return "stand-in";
  if (state.pausedUntil !== null && now < state.pausedUntil) return "stand-in";
  if (state.pausedUntil !== null) {
    state.pausedUntil = null;
    state.recent = [];
  }
  return "real";
}

/** A plan run whose Jev questions go to the stand-in (with its longer timeouts). */
export function planUsesJevStandIn(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): boolean {
  if (!localChatGptPlanEnabled(env)) return false;
  if (!planRealJevEnabled(env)) return true;
  return state.pausedUntil !== null && now < state.pausedUntil;
}

/** Record one real Jev call; enough failures switch the run to the stand-in. */
export function recordRealJevCall(
  outcome: { ok: true; costUsd?: number } | { ok: false; error: unknown },
  now: number = Date.now(),
): void {
  state.calls += 1;
  if (outcome.ok) state.costUsd += outcome.costUsd ?? 0;
  else state.failures += 1;
  state.recent.push(outcome.ok);
  if (state.recent.length > RECENT_CALLS) state.recent.shift();
  if (state.pausedUntil !== null) return;
  const failed = state.recent.filter((ok) => !ok).length;
  const budgetStop =
    !outcome.ok && outcome.error instanceof AiGatewayBudgetError;
  if (
    budgetStop ||
    (state.recent.length >= MIN_CALLS_TO_JUDGE &&
      failed / state.recent.length > MAX_FAILURE_SHARE)
  )
    pause(
      now,
      budgetStop
        ? "the Gateway budget stopped it"
        : `${failed} of ${state.recent.length} recent calls failed`,
    );
}

function pause(now: number, why: string): void {
  state.pausedUntil = now + PLAN_JEV_PAUSE_MS;
  state.standInWindows.push({ from: now, to: state.pausedUntil });
  recordCoreWarning(
    { operation: "plan_real_jev" },
    {
      message: `Real Jev paused for ${PLAN_JEV_PAUSE_MS / 60_000} min (${why})`,
      why: "Real Jev failed too often on this ChatGPT plan run",
      fix: `Jev questions use the plan's stand-in until ${new Date(state.pausedUntil).toISOString()}, then real Jev is tried again; rerun the stand-in results with real Jev.`,
    },
  );
}

/** Whether the stand-in answered any Jev question between `from` and `to`. */
export function planJevStandInDuring(from: Date, to: Date): boolean {
  if (!planRealJevEnabled()) return localChatGptPlanEnabled();
  return state.standInWindows.some(
    (window) => window.from < to.getTime() && window.to > from.getTime(),
  );
}

/** Real Jev calls, failures and cost so far, and the stand-in windows. */
export function planJevStats(): {
  calls: number;
  failures: number;
  costUsd: number;
  standInWindows: { from: string; to: string }[];
} {
  return {
    calls: state.calls,
    failures: state.failures,
    costUsd: state.costUsd,
    standInWindows: state.standInWindows.map((window) => ({
      from: new Date(window.from).toISOString(),
      to: new Date(window.to).toISOString(),
    })),
  };
}
