import { describe, expect, it } from "vitest";

import type {
  NullableTaskShare,
  TaskShare,
} from "@/lib/clients/generated/core/types.gen";

/**
 * Regression guard for the generated Core client.
 *
 * The OpenAPI generator collapses a nullable property into the referenced
 * component when a route reuses it, which can turn the shared `TaskShare`
 * component nullable depending on route traversal order. `task.schema.ts`
 * registers the nullable task share under its own `NullableTaskShare`
 * component to keep the bare `TaskShare` non-nullable. The `@ts-expect-error`
 * below fails `tsc` (and thus `pnpm --filter web typecheck`) if that ever
 * regresses.
 */
describe("generated task share types", () => {
  it("keeps TaskShare non-nullable and NullableTaskShare nullable", () => {
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

    const nullableShare: NullableTaskShare = null;
    expect(nullableShare).toBeNull();
  });
});
