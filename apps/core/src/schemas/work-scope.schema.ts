import { z } from "@hono/zod-openapi";

/** Whose work a list shows: what the viewer is responsible for, or all of it. */
export type WorkScope = "mine" | "workspace";

/**
 * The `scope` query parameter of every work list (Tasks, Jobs, History,
 * Calendar). `mine` selects work the viewer is responsible for (ADR 0056).
 * `owned` is the old name of `mine`, still accepted and read as `mine`, so
 * handlers only ever see `mine` or `workspace`.
 */
export function workScopeQuerySchema(params: {
  defaultScope: WorkScope;
  description: string;
}) {
  return z
    .enum(["workspace", "mine", "owned"])
    .default(params.defaultScope)
    .transform((scope): WorkScope => (scope === "owned" ? "mine" : scope))
    .openapi({
      param: { name: "scope", in: "query" },
      description: `${params.description} Defaults to '${params.defaultScope}'. 'mine': work you are responsible for. 'workspace': all work in the active workspace. 'owned': Deprecated. Use mine.`,
      example: "workspace",
    });
}
