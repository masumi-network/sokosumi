import { dailyEvalsEnabled } from "@/lib/evals/eval-environment";
import { createDailyEvalRun, tickEvalRuns } from "./eval-runs.service";

export const EVAL_TICK_LOCK_KEY = "evals-tick";
/** 04:00 UTC: after the night's deploys, before anyone looks in the morning. */
const DAILY_RUN_HOUR_UTC = 4;

/**
 * The minute cron: on mainnet it queues the day's run once 04:00 UTC has
 * passed, and everywhere it moves the running run on, so a run started from
 * the admin page or the CLI on preprod finishes too.
 */
export async function syncEvals(shouldContinue: () => boolean) {
  const queued =
    dailyEvalsEnabled() && new Date().getUTCHours() >= DAILY_RUN_HOUR_UTC
      ? await createDailyEvalRun()
      : null;
  const tick = await tickEvalRuns(shouldContinue);
  return { dailyRunId: queued?.id ?? null, ...tick };
}
