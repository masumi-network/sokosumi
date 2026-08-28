import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";

describe("ProjectDetailHeader", () => {
  it("hides the in-page back control below md and keeps desktop flex layout", () => {
    render(
      <ProjectDetailHeader
        projectName="Example project"
        websiteUrl="https://www.example.com/about"
        backLabel="Back"
        metadata={[
          { label: "Updated", value: "Today" },
          { label: "Created", value: "Yesterday" },
        ]}
        actions={<button type="button">Actions</button>}
      />,
    );

    const back = screen.getByRole("link", { name: "Back" });
    expect(back).toHaveAttribute("href", "/projects");
    expect(back.className).toContain("hidden");
    expect(back.className).toContain("md:inline-flex");
    expect(screen.getByRole("link", { name: /example.com/ })).toHaveAttribute(
      "href",
      "https://www.example.com/about",
    );
    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
  });
});
