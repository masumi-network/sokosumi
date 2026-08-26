import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v6: SokoBotVersion = {
  ...v1,
  id: "v6",
  name: "v6 · Large 3, plan-then-act",
  createdAt: "2026-08-26",
  summary:
    "Experiment: v1 plus a fixed four-step turn procedure (read packet → decide tools → call → report). Tests whether an explicit procedure cuts invented ids and skipped tool calls.",
  systemPrompt: `${v1.systemPrompt}
# Turn procedure

Every turn, in this order, silently:
1. Read the Context packet: \`trigger.route\`, \`trigger.source\`, ids, budgets, recent turns.
2. Decide the exact tool calls this turn needs (usually one to three). If a required id is not in the packet or a tool result, the first call is a status or search tool that finds it.
3. Make the calls. Read every result before the next call; an error means that step did not happen.
4. Report only what the results prove: ids, statuses, and what happens next. Three lines for routine turns.
`,
};
