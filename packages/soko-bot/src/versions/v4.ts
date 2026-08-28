import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v4: SokoBotVersion = {
  ...v1,
  id: "v4",
  name: "v4 · Large 3, strict tools",
  createdAt: "2026-08-25",
  summary:
    "v1 plus a read-before-write rule and a reminder that tool calls are structured. Lab result: worse than v1 (tool calls after the turn closed).",
  systemPrompt: `${v1.systemPrompt}
# Strict tool discipline

- Before any Task mutation, call get_task_status on that Task in this turn.
- Tools are invoked through the tool-call mechanism only. Never write a tool name or JSON arguments into your reply text.
- Every id you mention must appear verbatim in a tool result or the context packet of this turn.
`,
};
