import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ProjectLatestUpdate } from "@/app/projects/components/project-latest-update";

const REPORT = `# Weekly Activity Report

Date window: 2026-09-01 to 2026-09-07

## TL;DR

Shipped onboarding polish.

## Audience

Reached technical founders.`;

describe("ProjectLatestUpdate", () => {
  it("renders the weekly report markdown", () => {
    render(
      <ProjectLatestUpdate
        title="Latest update"
        content={REPORT}
        showMoreLabel="Show more"
        showLessLabel="Show less"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Latest update" }),
    ).toBeInTheDocument();
    expect(screen.getByText("TL;DR")).toBeInTheDocument();
    expect(screen.getByText(/Shipped onboarding polish/)).toBeInTheDocument();
  });

  it("collapses long reports until expanded", async () => {
    const user = userEvent.setup();
    const content = `${REPORT}\n\n${"Long update. ".repeat(80)}`;

    render(
      <ProjectLatestUpdate
        title="Latest update"
        content={content}
        showMoreLabel="Show more"
        showLessLabel="Show less"
      />,
    );

    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
