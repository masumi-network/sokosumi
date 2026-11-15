import { dailyEvalsEnabled } from "@/lib/evals/eval-environment";
import {
  createWeeklyEvalRun,
  evalWeekStart,
  tickEvalRuns,
} from "./eval-runs.service";

export const EVAL_TICK_LOCK_KEY = "evals-tick";
/** Monday 04:00 UTC: after the weekend's deploys, before anyone looks on Monday. */
const WEEKLY_RUN_HOUR_UTC = 4;

/**
 * The minute cron: on mainnet it queues the week's run once Monday 04:00 UTC
 * has passed, and everywhere it moves the running run on, so a run started
 * from the admin page or the CLI on preprod finishes too.
 */
export async function syncEvals(shouldContinue: () => boolean) {
  const now = new Date();
  const runFrom = evalWeekStart(now);
  runFrom.setUTCHours(WEEKLY_RUN_HOUR_UTC);
  const queued =
    dailyEvalsEnabled() && now >= runFrom
      ? await createWeeklyEvalRun(now)
      : null;
  const tick = await tickEvalRuns(shouldContinue);
  return { weeklyRunId: queued?.id ?? null, ...tick };
}
