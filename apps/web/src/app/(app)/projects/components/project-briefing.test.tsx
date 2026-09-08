import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ProjectBriefing } from "@/app/projects/components/project-briefing";

describe("ProjectBriefing", () => {
  it("renders empty copy without a section-header edit control", () => {
    render(
      <ProjectBriefing
        title="Briefing"
        briefing={null}
        emptyLabel="No briefing yet."
        editHref="/projects/project-1/edit"
        emptyActionLabel="Write briefing"
        showMoreLabel="Show more"
        showLessLabel="Show less"
      />,
    );

    expect(screen.getByText("No briefing yet.")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Write briefing" }),
    ).toHaveAttribute("href", "/projects/project-1/edit");
  });

  it("collapses long briefings until expanded", async () => {
    const user = userEvent.setup();
    const briefing = `${"Long briefing. ".repeat(80)}## Goals\nWin.`;

    render(
      <ProjectBriefing
        title="Briefing"
        briefing={briefing}
        emptyLabel="No briefing yet."
        showMoreLabel="Show more"
        showLessLabel="Show less"
      />,
    );

    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("project-briefing-content")).not.toHaveAttribute(
      "inert",
    );
    await user.click(toggle);
    const expandedToggle = screen.getByRole("button", { name: "Show less" });
    expect(expandedToggle).toHaveAttribute("aria-expanded", "true");
  });
});
