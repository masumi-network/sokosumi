import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";

describe("ProjectDetailHeader", () => {
  it("renders the name as the page heading beside the project actions", () => {
    render(
      <ProjectDetailHeader
        projectName="Example project"
        actions={<button type="button">Actions</button>}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Example project" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    // Website and dates moved to the Properties rail.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("term")).not.toBeInTheDocument();
  });

  it("wraps a long name instead of truncating it", () => {
    render(<ProjectDetailHeader projectName="A very long project name" />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).not.toContain("truncate");
    expect(heading.className).toContain("break-words");
  });
});
