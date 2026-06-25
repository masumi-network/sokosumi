import { TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { isDnDDragColumn, isDnDDropColumn, statusForColumn } from "../task-dnd";

describe("task-dnd", () => {
  describe("isDnDDragColumn", () => {
    it("allows backlog and todo as drag sources", () => {
      expect(isDnDDragColumn("backlog")).toBe(true);
      expect(isDnDDragColumn("todo")).toBe(true);
    });

    it("disallows other columns as drag sources", () => {
      expect(isDnDDragColumn("in-progress")).toBe(false);
      expect(isDnDDragColumn("done")).toBe(false);
    });
  });

  describe("isDnDDropColumn", () => {
    it("allows backlog and todo as drop targets", () => {
      expect(isDnDDropColumn("backlog")).toBe(true);
      expect(isDnDDropColumn("todo")).toBe(true);
    });

    it("disallows other columns as drop targets", () => {
      expect(isDnDDropColumn("in-progress")).toBe(false);
      expect(isDnDDropColumn("done")).toBe(false);
    });
  });

  describe("statusForColumn", () => {
    it("maps todo to READY", () => {
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
