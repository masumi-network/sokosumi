import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectsLoadingView } from "@/app/projects/components/projects-loading-view";

describe("ProjectsLoadingView", () => {
  it("hides header create below md and pads for the mobile FAB", () => {
    const { container } = render(
      <ProjectsLoadingView labels={{ newProject: "New Project" }} />,
    );

    const headerRow = container.querySelector(".hidden.justify-end.md\\:flex");
    expect(headerRow).toBeTruthy();
    expect(container.firstElementChild?.className).toContain(
      "pb-[calc(3.5rem+1rem)]",
    );
    expect(container.firstElementChild?.className).toContain("md:pb-0");
  });
});
