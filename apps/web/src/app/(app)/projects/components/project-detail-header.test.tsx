import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";

describe("ProjectDetailHeader", () => {
  it("places metadata as a full-width sibling row below the title", () => {
    const { container } = render(
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

    const root = container.firstElementChild;
    expect(root?.className).not.toContain("px-4");
    expect(root?.className).not.toContain("md:px-0");

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
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    // The dates describe the project, so they sit under its name rather than
    // as a third full-width row of chrome above the content.
    const heading = screen.getByRole("heading", { name: "Example project" });
    const metadata = root?.querySelector("dl");
    expect(metadata).toBeTruthy();
    expect(heading.parentElement?.parentElement?.contains(metadata!)).toBe(
      true,
    );
  });

  it("shows a project-specific back link on mobile when requested", () => {
    render(
      <ProjectDetailHeader
        {...{
          backHref: "/projects/project-1",
          showBackOnMobile: true,
        }}
        projectName="Example project"
        backLabel="Back to project"
        metadata={[]}
      />,
    );

    // Visible where the app header's breadcrumb is not, and only there:
    // stacking a second way back above the title is chrome, not wayfinding.
    const back = screen.getByRole("link", { name: "Back to project" });
    expect(back).toHaveAttribute("href", "/projects/project-1");
    expect(back.className).toContain("inline-flex");
    expect(back.className).toContain("sm:hidden");
  });
});
