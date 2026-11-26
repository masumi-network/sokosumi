import type { CmoApplyLog, CmoApplyOp } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { cmoApplyRecovery } from "./cmo-change-apply.service";

const op = (opId: string, state: CmoApplyOp["state"]): CmoApplyOp => ({
  opId,
  entryId: opId,
  kind: "swap",
  postId: `post-${opId}`,
  prior: null,
  state,
});
const log = (state: CmoApplyLog["state"], ops: CmoApplyOp[]): CmoApplyLog => ({
  baseVersionId: "base",
  baseUpdatedAt: "2026-11-26T00:00:00.000Z",
  state,
  startedAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
  ops,
});

describe("recovering a crashed apply", () => {
  it("rolls back every op that may have written, newest first", () => {
    expect(
      cmoApplyRecovery(
        log("applying", [
          op("a", "done"),
          op("b", "refused"),
          op("c", "intent"),
        ]),
      ).map((step) => [step.op.opId, step.action]),
    ).toEqual([
      ["c", "undo"],
      ["b", "none"],
      ["a", "undo"],
    ]);
  });

  it("keeps undoing an undo that crashed", () => {
    expect(
      cmoApplyRecovery(log("undoing", [op("a", "done")])).map(
        (step) => step.action,
      ),
    ).toEqual(["undo"]);
  });

  it("never finishes forward or touches a settled apply", () => {
    for (const state of ["applied", "undone", "left"] as const)
      expect(cmoApplyRecovery(log(state, [op("a", "done")]))).toEqual([]);
  });
});
