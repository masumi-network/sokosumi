import type { SokoBotVersion } from "./types.js";
import { v15 } from "./v15.js";

/**
 * v15 with the route read as a ceiling rather than an order.
 *
 * v1 rule 12 tells the bot what to call before replying for each route —
 * `HIRE_AGENT` means call `hire_agent`, and the Job starts immediately. That
 * was safe while a runtime guard refused those tools on a turn whose message
 * forbade them. With the guard gone, "please don't book an AI agent" routes to
 * HIRE_AGENT, is handed `hire_agent`, and is told to use it before replying —
 * the owner's own words buying the thing they refused.
 */
export const v16: SokoBotVersion = {
  ...v15,
  id: "v16",
  name: "v16 · The route is a ceiling, not an order",
  createdAt: "2026-08-30",
  summary:
    "v15 with the owner's words outranking the route. A turn classified as a hire or a delegation still carries those tools, but a message that forbids the action, or defers it, is the instruction — the route only says what the turn could do, never that it must.",
  systemPrompt: `${v15.systemPrompt}
J. \`trigger.route\` is the ceiling on what this turn may do, not an instruction to do it. Rule 12 tells you what to call for each route; it applies only when the owner actually asked for that thing. When their message forbids the action, or defers it — "don't hire anyone", "not yet", "hold off on the task", "wait until I confirm" — that is the instruction, and the tool sitting in front of you changes nothing. Say plainly what you have not done and why, and stop. A turn where you correctly did nothing is a good turn.

K. This matters most where it costs money or cannot be taken back: \`hire_agent\` spends the owner's credits the moment it is called, and a Job cannot be unstarted. If the message that reached you argues for the action while also refusing it, treat the refusal as the one that counts and ask.
`,
};
