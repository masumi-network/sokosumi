import type { Task, TaskFile } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { canImportSeoTask, seoImportFiles } from "./seo-import-model";

const candidate = {
  projectId: null,
  ownerId: "owner",
  visibility: "PUBLIC",
  status: "COMPLETED",
} as const;
const file = {
  id: "ready",
  name: "seo-report-task.json",
  status: "READY",
  mimeType: "application/json",
  uploader: { type: "coworker", id: "seo" },
} as TaskFile;
const reportTask = {
  id: "task",
  assignee: { type: "coworker", id: "seo" },
  files: [file],
} as Pick<Task, "id" | "assignee" | "files">;
describe("SEO import picker authorization", () => {
  it("accepts an owned, completed public Task before project assignment", () => {
    expect(canImportSeoTask(candidate, "project", "owner")).toBe(true);
    expect(
      canImportSeoTask(
        { ...candidate, projectId: "project" },
        "project",
        "owner",
      ),
    ).toBe(true);
  });
  it("excludes private, other-project, incomplete and other-owner Tasks", () => {
    expect(
      canImportSeoTask(
        { ...candidate, visibility: "PRIVATE" },
        "project",
        "owner",
      ),
    ).toBe(false);
    expect(
      canImportSeoTask(
        { ...candidate, projectId: "other" },
        "project",
        "owner",
      ),
    ).toBe(false);
    expect(
      canImportSeoTask({ ...candidate, status: "RUNNING" }, "project", "owner"),
    ).toBe(false);
    expect(canImportSeoTask(candidate, "project", "other")).toBe(false);
  });
  it("offers only the exact READY JSON report from the assigned Coworker", () => {
    const files = [
      file,
      { ...file, id: "pending", status: "PENDING" },
      { ...file, id: "name", name: "report.json" },
      { ...file, id: "type", mimeType: "text/plain" },
      { ...file, id: "actor", uploader: { type: "coworker", id: "other" } },
    ] as TaskFile[];
    expect(
      seoImportFiles({ ...reportTask, files }).map((item) => item.id),
    ).toEqual(["ready"]);
    expect(seoImportFiles({ ...reportTask, assignee: null })).toEqual([]);
  });
});
