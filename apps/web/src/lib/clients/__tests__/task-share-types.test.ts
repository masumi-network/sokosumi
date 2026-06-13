import { describe, expect, it } from "vitest";

import type { TaskShare } from "@/lib/clients/generated/core/types.gen";

/**
 * Regression guard for the generated Core client.
 *
 * `taskSchema.share` uses `z.union([taskShareSchema, z.null()])` rather than
 * `taskShareSchema.nullable()` so the shared `TaskShare` component stays a
 * non-nullable object: a `.nullable()` on a named component both leaks `| null`
 * into the `TaskShare` type and makes the generated response transformer call
 * the share date-converter unconditionally (crashing on a null share). The
 * `@ts-expect-error` below fails `tsc` (and thus `pnpm --filter web typecheck`)
 * if `TaskShare` ever regresses to nullable.
 */
describe("generated TaskShare type", () => {
  it("stays a non-nullable object", () => {
    const share: TaskShare = {
      id: "share_1",
      token: "tok",
      allowSearchIndexing: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      taskId: "tsk_1",
    };
    expect(share.id).toBe("share_1");

    // @ts-expect-error TaskShare must not accept null (regression guard).
    const nullShare: TaskShare = null;
    expect(nullShare).toBeNull();
  });
});
