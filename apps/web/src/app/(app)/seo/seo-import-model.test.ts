import { describe, expect, it } from "vitest";
import { canImportSeoTask } from "./seo-import-model";

const candidate = {
  projectId: null,
  ownerId: "owner",
  visibility: "PUBLIC",
  status: "COMPLETED",
} as const;
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
});
