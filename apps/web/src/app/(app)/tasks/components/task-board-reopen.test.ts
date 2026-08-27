import { describe, expect, it } from "vitest";

import { shouldRollbackBoardReopenOnDismiss } from "./task-board-reopen";

describe("shouldRollbackBoardReopenOnDismiss", () => {
  it("rolls back when the dialog is dismissed and submit is idle", () => {
    expect(shouldRollbackBoardReopenOnDismiss(false)).toBe(true);
  });

  it("does not roll back while reopen submit is in flight", () => {
    expect(shouldRollbackBoardReopenOnDismiss(true)).toBe(false);
  });
});
