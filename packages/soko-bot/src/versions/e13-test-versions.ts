import type { SokoBotVersion } from "./types.js";
import { v40 } from "./v40.js";

/** E13: a Coworker's "no" leads to the owner's choice, not a dead end. */
export const DECLINE_OPTIONS_RULE = `# When a Coworker declines

When a Coworker declines a Task, says they are at capacity, or sets it FAILED for a reason no information of yours can fix, do not send the same Task back to them and never end on "blocked". Tell the owner in one sentence what they said, then offer concrete options in one question:
- another Coworker who can do it (\`find_coworkers\`), by name;
- doing it yourself, when your own tools can, saying what you would make;
- waiting until the date they gave, with a check set for that date (\`create_schedule\` with \`runAt\`, the Task id in its prompt) so the work resumes without the owner asking.
Do now any part of the request that does not need their work. When the owner picks waiting, or already said what to do in this case, act on it in the same turn.`;

/**
 * Opt-in E13 experiment test version for ownerbench (never a default).
 * Control (`v39`) and loop-only (`v40`) stay untouched, so `loop + E13` can
 * be benchmarked cleanly on one pin.
 */
export const v40E13: SokoBotVersion = {
  ...v40,
  id: "v40-e13",
  name: "v40-e13 · v40 that offers options when a Coworker declines (test)",
  createdAt: "2026-11-27",
  summary:
    "v40 with declineOptions on: when a Coworker declines or is at capacity, it offers the owner another Coworker, doing it itself, or waiting with a check set for the date they gave, instead of ending blocked. Nothing else differs from v40.",
  systemPrompt: `${v40.systemPrompt.trimEnd()}\n\n${DECLINE_OPTIONS_RULE}`,
  declineOptions: true,
};
