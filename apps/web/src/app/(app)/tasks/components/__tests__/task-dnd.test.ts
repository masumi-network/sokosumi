import { TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { isDnDColumn, statusForColumn } from "../task-dnd";

describe("task-dnd", () => {
  describe("isDnDColumn", () => {
    it("allows backlog and todo", () => {
      expect(isDnDColumn("backlog")).toBe(true);
      expect(isDnDColumn("todo")).toBe(true);
    });

    it("disallows other columns", () => {
      expect(isDnDColumn("in-progress")).toBe(false);
      expect(isDnDColumn("done")).toBe(false);
    });
  });

  describe("statusForColumn", () => {
    it("maps todo to READY so backlog QUEUED tasks can move to ready", () => {
      expect(statusForColumn("todo")).toBe(TaskStatus.READY);
    });

    it("maps backlog to DRAFT for drops into backlog (re-queue UI deferred)", () => {
      expect(statusForColumn("backlog")).toBe(TaskStatus.DRAFT);
    });

    it("returns null for non-dnd columns", () => {
      expect(statusForColumn("in-progress")).toBeNull();
    });
  });
});
