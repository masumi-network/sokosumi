import { describe, expect, it, vi } from "vitest";

const projectPageMetadata = vi.hoisted(() =>
  vi.fn(async () => ({ title: "Spring launch" })),
);

vi.mock("@/app/projects/[projectId]/project-page-metadata", () => ({
  projectPageMetadata,
}));
vi.mock("@/app/projects/[projectId]/components/record-project-visit", () => ({
  RecordProjectVisit: () => null,
}));

import { generateMetadata } from "@/app/projects/[projectId]/layout";

describe("project pages' default title", () => {
  // Pages without a section of their own, such as Overview, are titled by
  // the project's name.
  it("is the project's name", async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ projectId: "p1" }) }),
    ).resolves.toEqual({ title: "Spring launch" });
    expect(projectPageMetadata).toHaveBeenCalledWith("p1");
  });
});
