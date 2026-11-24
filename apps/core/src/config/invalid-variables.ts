import type { z } from "zod";

/**
 * What a log may keep of each failed check: the variable, the issue's path
 * and code, and Zod's message unless it quotes the variable's value. Zod 4
 * messages describe the expected value, but a refinement's own message can
 * say anything.
 */
export function invalidVariables(
  issues: readonly z.core.$ZodIssue[],
  env: NodeJS.ProcessEnv,
) {
  return issues.map((issue) => {
    const variable = String(issue.path[0] ?? "");
    const value = env[variable];
    const quotesValue = Boolean(value) && issue.message.includes(value ?? "");
    return {
      variable,
      path: issue.path.join("."),
      code: issue.code,
      ...(quotesValue ? {} : { message: issue.message }),
    };
  });
}
