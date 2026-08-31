import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";

describe("ProjectDetailHeader", () => {
  it("pads on mobile, keeps desktop flex layout, and places metadata as a full-width sibling row", () => {
    const { container } = render(
      <ProjectDetailHeader
        calendarLabel="Calendar"
        projectName="Example project"
        projectId="project-1"
        websiteUrl="https://www.example.com/about"
        backLabel="Back"
        metadata={[
          { label: "Updated", value: "Today" },
          { label: "Created", value: "Yesterday" },
        ]}
        navigationLabel="Project navigation"
        overviewLabel="Overview"
        selectedView="overview"
        showCalendar
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
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "href",
      "/projects/project-1/calendar",
    );

    const titleRow = root?.children[1];
    const metadata = root?.querySelector("dl");
    expect(titleRow).toBeTruthy();
    expect(metadata).toBeTruthy();
    expect(metadata?.className).toContain("w-full");
    expect(titleRow?.contains(metadata!)).toBe(false);
    expect(metadata?.previousElementSibling).toBe(titleRow);
  });

  it("hides the Calendar link when the feature is unavailable", () => {
    render(
      <ProjectDetailHeader
        calendarLabel="Calendar"
        projectName="Example project"
        projectId="project-1"
        backLabel="Back"
        metadata={[]}
        navigationLabel="Project navigation"
        overviewLabel="Overview"
        selectedView="overview"
        showCalendar={false}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "Calendar" }),
    ).not.toBeInTheDocument();
  });
});
