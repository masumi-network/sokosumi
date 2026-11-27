import { beforeEach, describe, expect, it, vi } from "vitest";

const getProjectById = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    `${key}:${values?.section}|${values?.project}`,
}));

import { projectPageMetadata } from "@/app/projects/[projectId]/project-page-metadata";

describe("projectPageMetadata", () => {
  beforeEach(() => {
    getProjectById.mockReset();
  });

  // The route announcer reads the title out on every navigation, and only
  // when it changes: each page names itself and the project it belongs to.
  it("titles the project's own page with its name", async () => {
    getProjectById.mockResolvedValue({ name: "Spring launch" });

    await expect(projectPageMetadata("p1")).resolves.toEqual({
      title: "Spring launch",
    });
    expect(getProjectById).toHaveBeenCalledWith("p1");
  });

  it("puts a section's name before the project's", async () => {
    getProjectById.mockResolvedValue({ name: "Spring launch" });

    await expect(projectPageMetadata("p1", "Design")).resolves.toEqual({
      title: "sectionTitle:Design|Spring launch",
    });
  });

  it("keeps the app's title when the project is not available", async () => {
    getProjectById.mockResolvedValue(null);

    await expect(projectPageMetadata("p1", "Design")).resolves.toEqual({});
  });

  it("keeps the app's title, not an error page, when the read fails", async () => {
    getProjectById.mockRejectedValue(new Error("Core is down"));

    await expect(projectPageMetadata("p1")).resolves.toEqual({});
  });
});
