import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";

describe("ProjectDetailHeader", () => {
  it("hides the in-page back control below md and keeps desktop flex layout", () => {
    const { container } = render(
      <ProjectDetailHeader
        projectName="Example project"
        backLabel="Back"
        metadata={[]}
        actions={<button type="button">Actions</button>}
      />,
    );

    const row = container.querySelector(".flex.items-center");
    expect(row?.className).toContain("justify-end");
    expect(row?.className).toContain("md:justify-between");

    const back = screen.getByRole("link", { name: "Back" });
    expect(back.className).toContain("hidden");
    expect(back.className).toContain("md:inline-flex");
  });
});
