import { beforeEach, describe, expect, it, vi } from "vitest";

const loadProjectOverviewData = vi.hoisted(() => vi.fn());

vi.mock("./project-overview-data", () => ({ loadProjectOverviewData }));
vi.mock("./components/record-project-visit", () => ({
  RecordProjectVisit: () => null,
}));

import { generateMetadata } from "./layout";

describe("project pages' title", () => {
  beforeEach(() => {
    loadProjectOverviewData.mockReset();
  });

  // The route announcer reads the title out on every navigation, so the
  // app's tagline there told a screen reader nothing about the page.
  it("is the project's name", async () => {
    loadProjectOverviewData.mockResolvedValue({
      project: { name: "Spring launch" },
    });

    await expect(
      generateMetadata({ params: Promise.resolve({ projectId: "p1" }) }),
    ).resolves.toEqual({ title: "Spring launch" });
    expect(loadProjectOverviewData).toHaveBeenCalledWith("p1");
  });

  it("keeps the app's title when the project is not available", async () => {
    loadProjectOverviewData.mockResolvedValue(null);

    await expect(
      generateMetadata({ params: Promise.resolve({ projectId: "p1" }) }),
    ).resolves.toEqual({});
  });
});
