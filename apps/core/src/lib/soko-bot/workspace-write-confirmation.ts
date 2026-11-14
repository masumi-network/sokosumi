import { posix } from "node:path";
import { z } from "zod";

const MAX_WORKSPACE_PATH_CHARS = 500;
const MAX_WORKSPACE_WRITE_OUTPUT_CHARS = 4_096;
const MIN_CODE_FENCE_LENGTH = 3;
const pathSchema = z.string().min(1).max(MAX_WORKSPACE_PATH_CHARS);
const resultSchema = z.object({
  path: pathSchema,
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

type WorkspaceCall = {
  capability: string;
  status: string;
  input: unknown;
  result: unknown;
};

/** Calls arrive in persisted creation order. A later attempt replaces its path. */
export function workspaceWriteConfirmations(calls: readonly WorkspaceCall[]) {
  const latest = new Map<string, WorkspaceCall>();
  for (const call of calls) {
    if (call.capability !== "workspace_write") continue;
    const input = z.object({ path: pathSchema }).safeParse(call.input);
    if (input.success) latest.set(posix.normalize(input.data.path), call);
  }
  return [...latest.values()].flatMap((call) => {
    if (call.status !== "COMPLETED") return [];
    const input = z.object({ path: pathSchema }).safeParse(call.input);
    const stored = z
      .object({ output: z.string().max(MAX_WORKSPACE_WRITE_OUTPUT_CHARS) })
      .safeParse(call.result);
    if (!input.success || !stored.success) return [];
    try {
      const result = resultSchema.safeParse(JSON.parse(stored.data.output));
      if (!result.success || result.data.path !== input.data.path) return [];
      // Code keeps URL-shaped filenames out of citation filtering. JSON keeps
      // control characters on one data line; a longer fence contains backticks.
      const filename = JSON.stringify(result.data.path).replace(
        /[\u2028\u2029]/g,
        (char) => (char === "\u2028" ? "\\u2028" : "\\u2029"),
      );
      const ticks = filename.match(/`+/g);
      if (!ticks) return [`Saved workspace file: \`${filename}\`.`];
      const fence = "`".repeat(
        Math.max(MIN_CODE_FENCE_LENGTH, ...ticks.map((run) => run.length + 1)),
      );
      return [`Saved workspace file:\n${fence}\n${filename}\n${fence}`];
    } catch {
      return [];
    }
  });
}
