import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";

describe("ProjectDetailHeader", () => {
  it("pads on mobile and places metadata as a full-width sibling row", () => {
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
    expect(root?.className).toContain("px-4");
    expect(root?.className).toContain("md:px-0");

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

    const titleRow = root?.children[1];
    const metadata = root?.querySelector("dl");
    expect(titleRow).toBeTruthy();
    expect(metadata).toBeTruthy();
    expect(metadata?.className).toContain("w-full");
    expect(titleRow?.contains(metadata!)).toBe(false);
    expect(metadata?.previousElementSibling).toBe(titleRow);
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

    const back = screen.getByRole("link", { name: "Back to project" });
    expect(back).toHaveAttribute("href", "/projects/project-1");
    expect(back.className).not.toContain("hidden");
  });
});
