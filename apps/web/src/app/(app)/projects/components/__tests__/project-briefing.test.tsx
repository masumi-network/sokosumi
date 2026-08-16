import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ProjectBriefing } from "@/app/projects/components/project-briefing";

describe("ProjectBriefing", () => {
  it("renders empty copy and an edit link", () => {
    render(
      <ProjectBriefing
        title="Briefing"
        briefing={null}
        emptyLabel="No briefing yet."
        editHref="/projects/project-1/edit"
        editLabel="Edit"
        emptyActionLabel="Write briefing"
        showMoreLabel="Show more"
        showLessLabel="Show less"
      />,
    );

    expect(screen.getByText("No briefing yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/projects/project-1/edit",
    );
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
    await user.click(toggle);
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
  });
});
