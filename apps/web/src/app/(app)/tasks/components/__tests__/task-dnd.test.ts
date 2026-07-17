import { describe, expect, it } from "vitest";
import { TaskStatus } from "@/lib/clients/generated/core";

import {
  isDnDDragColumn,
  isDnDDropColumn,
  isTaskDnDDraggable,
  statusForColumn,
} from "../task-dnd";

describe("task-dnd", () => {
  describe("isDnDDragColumn", () => {
    it("allows backlog, todo, and done as drag sources", () => {
      expect(isDnDDragColumn("backlog")).toBe(true);
      expect(isDnDDragColumn("todo")).toBe(true);
      expect(isDnDDragColumn("done")).toBe(true);
    });

    it("disallows other columns as drag sources", () => {
      expect(isDnDDragColumn("in-progress")).toBe(false);
      expect(isDnDDragColumn("input-required")).toBe(false);
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
      expect(statusForColumn("done")).toBeNull();
    });
  });

  describe("isTaskDnDDraggable", () => {
    const scheduledMetadata = JSON.stringify({
      schedule: { mode: "daily", timezone: "UTC" },
    });
    const assignee = {
      id: "cow-1",
      name: "Elena",
      slug: "elena",
      image: null,
    };

    it("allows draft backlog tasks", () => {
      expect(
        isTaskDnDDraggable({
          status: TaskStatus.DRAFT,
          metadata: null,
          nextRunAt: null,
          assignee: null,
        }),
      ).toBe(true);
    });

    it("disallows scheduled queued backlog tasks", () => {
      expect(
        isTaskDnDDraggable({
          status: TaskStatus.QUEUED,
          metadata: scheduledMetadata,
          nextRunAt: "2026-06-25T09:00:00.000Z",
          assignee,
        }),
      ).toBe(false);
    });

    it("allows queued tasks without an active schedule", () => {
      expect(
        isTaskDnDDraggable({
          status: TaskStatus.QUEUED,
          metadata: null,
          nextRunAt: null,
          assignee,
        }),
      ).toBe(true);
    });

    it("allows completed and canceled tasks with a coworker for reopen", () => {
      expect(
        isTaskDnDDraggable({
          status: TaskStatus.COMPLETED,
          metadata: null,
          nextRunAt: null,
          assignee,
        }),
      ).toBe(true);
      expect(
        isTaskDnDDraggable({
          status: TaskStatus.CANCELED,
          metadata: null,
          nextRunAt: null,
          assignee,
        }),
      ).toBe(true);
    });

    it("disallows terminal done tasks without a coworker", () => {
      expect(
        isTaskDnDDraggable({
          status: TaskStatus.COMPLETED,
          metadata: null,
          nextRunAt: null,
          assignee: null,
        }),
      ).toBe(false);
    });

    it("disallows failed tasks", () => {
      expect(
        isTaskDnDDraggable({
          status: TaskStatus.FAILED,
          metadata: null,
          nextRunAt: null,
          assignee,
        }),
      ).toBe(false);
    });
  });
});
