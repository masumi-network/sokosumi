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

    // One back affordance, and only where the app header's breadcrumb is
    // hidden. There is no desktop variant any more.
    const back = screen.getByRole("link", { name: "Back" });
    expect(back).toHaveAttribute("href", "/projects");
    expect(back.className).toContain("inline-flex");
    expect(back.className).toContain("sm:hidden");
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

  it("takes the surrounding surface's inset instead of spacing of its own", () => {
    const { container } = render(
      <ProjectDetailHeader
        backHref="/projects/project-1"
        className="px-4 md:px-6"
        projectName="Example project"
        backLabel="Back to project"
        metadata={[]}
      />,
    );

    // It is the workspace card's header now, so the card decides the gutter.
    const root = container.firstElementChild;
    expect(root?.className).toContain("px-4");
    expect(root?.className).toContain("md:px-6");
    expect(
      screen.getByRole("link", { name: "Back to project" }),
    ).toHaveAttribute("href", "/projects/project-1");
  });
});
