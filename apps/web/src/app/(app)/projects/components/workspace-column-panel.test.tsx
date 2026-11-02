import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceColumnPanel } from "./workspace-column-panel";

const rows = Array.from({ length: 5 }, (_, index) => ({
  key: `row-${index}`,
  node: <span>Row {index + 1}</span>,
}));

function hiddenWhenStacked() {
  return screen
    .getAllByTestId("panel-row")
    .map((row) => row.classList.contains("max-xl:hidden"));
}

describe("WorkspaceColumnPanel", () => {
  it("caps the stacked layout at 3 rows and Show all reveals the rest", () => {
    render(
      <WorkspaceColumnPanel
        testId="panel"
        title="Recent activity"
        empty="No activity"
        rows={rows}
        action={{ kind: "expand", label: "Show all" }}
      />,
    );

    expect(hiddenWhenStacked()).toEqual([false, false, false, true, true]);
    const showAll = screen.getByRole("button", { name: "Show all" });
    // Beside the grid every row shows, so the expander is stacked-only.
    expect(showAll).toHaveClass("xl:hidden");

    fireEvent.click(showAll);

    expect(hiddenWhenStacked()).toEqual([false, false, false, false, false]);
    expect(
      screen.queryByRole("button", { name: "Show all" }),
    ).not.toBeInTheDocument();
  });

  it("needs no Show all when 3 rows fit", () => {
    render(
      <WorkspaceColumnPanel
        testId="panel"
        title="Recent activity"
        empty="No activity"
        rows={rows.slice(0, 3)}
        action={{ kind: "expand", label: "Show all" }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Show all" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a link action at every width, beside the capped rows", () => {
    render(
      <WorkspaceColumnPanel
        testId="panel"
        title="Needs you"
        empty="Nothing waits on you."
        rows={rows}
        action={{ kind: "link", label: "Show all", href: "/notifications" }}
      />,
    );

    expect(hiddenWhenStacked()).toEqual([false, false, false, true, true]);
    const showAll = screen.getByRole("link", { name: "Show all" });
    expect(showAll).toHaveAttribute("href", "/notifications");
    expect(showAll).not.toHaveClass("xl:hidden");
  });

  it("says its one empty line, with no action, when there are no rows", () => {
    render(
      <WorkspaceColumnPanel
        testId="panel"
        title="Needs you"
        empty="Nothing waits on you."
        rows={[]}
        action={{ kind: "link", label: "Show all", href: "/notifications" }}
      />,
    );

    expect(screen.getByTestId("panel-empty")).toHaveTextContent(
      "Nothing waits on you.",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
