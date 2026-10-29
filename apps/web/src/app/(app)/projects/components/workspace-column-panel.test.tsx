import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceColumnPanel } from "./workspace-column-panel";

const rows = Array.from({ length: 5 }, (_, index) => ({
  key: `row-${index}`,
  node: <span>Row {index + 1}</span>,
}));

describe("WorkspaceColumnPanel", () => {
  it("shows every row at every width, beside its link", () => {
    render(
      <WorkspaceColumnPanel
        testId="panel"
        title="Needs you"
        empty="Nothing waits on you."
        rows={rows}
        action={{ label: "Show all", href: "/notifications" }}
      />,
    );

    const shown = screen.getAllByTestId("panel-row");
    expect(shown).toHaveLength(5);
    for (const row of shown) {
      expect(row.className).not.toMatch(/hidden/);
    }
    expect(screen.getByRole("link", { name: "Show all" })).toHaveAttribute(
      "href",
      "/notifications",
    );
  });

  it("says its one empty line, keeping an action the caller still passes", () => {
    render(
      <WorkspaceColumnPanel
        testId="panel"
        title="Projects"
        empty="No projects yet"
        rows={[]}
        action={{ label: "New project", href: "/projects?create=true" }}
      />,
    );

    expect(screen.getByTestId("panel-empty")).toHaveTextContent(
      "No projects yet",
    );
    expect(screen.getByRole("link", { name: "New project" })).toHaveAttribute(
      "href",
      "/projects?create=true",
    );
  });

  it("draws no action when the caller passes none", () => {
    render(
      <WorkspaceColumnPanel
        testId="panel"
        title="Needs you"
        empty="Nothing waits on you."
        rows={[]}
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
