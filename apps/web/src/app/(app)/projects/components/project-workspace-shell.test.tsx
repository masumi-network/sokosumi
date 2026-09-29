import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectWorkspaceShell } from "@/app/projects/components/project-workspace-shell";
import {
  TASK_DETAIL_GRID_CLASS,
  TASK_DETAIL_SHELL_CLASS,
  TASK_DETAIL_SIDEBAR_CLASS,
} from "@/app/tasks/constants";

/**
 * A project page laid out like a task page: the task detail shell and grid,
 * a main column with the name, tabs and content, and a Properties rail.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/p1/memory",
}));

const LABELS = {
  ariaLabel: "Project sections",
  design: "Design",
  memory: "Memory",
  overview: "Overview",
  properties: {
    title: "Properties",
    website: "Website",
    updated: "Updated",
    created: "Created",
  },
};

function renderShell() {
  return render(
    <ProjectWorkspaceShell
      createdAt="Yesterday"
      labels={LABELS}
      projectId="p1"
      projectName="Example project"
      updatedAt="Today"
      websiteUrl="https://example.com"
    >
      <p>area content</p>
    </ProjectWorkspaceShell>,
  );
}

function tabLinks() {
  const nav = screen.getByRole("navigation", { name: "Project sections" });
  return within(nav).getAllByRole("link");
}

describe("the project detail layout", () => {
  it("uses the task detail shell and grid, with no card", () => {
    const { container } = renderShell();

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toBe(TASK_DETAIL_SHELL_CLASS);
    const grid = shell.firstElementChild as HTMLElement;
    for (const cls of TASK_DETAIL_GRID_CLASS.split(/\s+/)) {
      expect(grid.classList).toContain(cls);
    }
    expect(container.querySelector(".bg-card-background")).toBeNull();
  });

  it("puts the Properties rail in the task sidebar slot", () => {
    renderShell();

    const aside = screen.getByRole("complementary");
    for (const cls of TASK_DETAIL_SIDEBAR_CLASS.split(/\s+/)) {
      expect(aside.classList).toContain(cls);
    }
    expect(
      within(aside).getByRole("heading", { name: "Properties" }),
    ).toBeInTheDocument();
    expect(within(aside).getByText("Today")).toBeInTheDocument();
    expect(within(aside).getByText("Yesterday")).toBeInTheDocument();
    expect(
      within(aside).getByRole("link", { name: /example\.com/ }),
    ).toBeInTheDocument();
  });

  it("orders name, rail, tabs, content, so the tabs touch their content", () => {
    renderShell();

    const heading = screen.getByRole("heading", { level: 1 });
    const aside = screen.getByRole("complementary");
    const nav = screen.getByRole("navigation", { name: "Project sections" });
    const content = screen.getByText("area content");
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(heading, aside)).toBe(true);
    expect(follows(aside, nav)).toBe(true);
    expect(follows(nav, content)).toBe(true);
    // Tabs and content share one block; the rail is never between them.
    expect(nav.parentElement?.contains(content)).toBe(true);
    expect(nav.parentElement?.contains(aside)).toBe(false);
  });

  it("marks the current tab", () => {
    renderShell();

    expect(screen.getByRole("link", { name: "Memory" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("navigates the three views a project actually has, and nothing else", () => {
    renderShell();

    // The studio, the calendar and Social are top-level destinations now: none
    // of them is an area *of* a project, so none of them is a tab here.
    expect(
      tabLinks().map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Overview", "/projects/p1"],
      ["Design", "/projects/p1/design-md"],
      ["Memory", "/projects/p1/memory"],
    ]);
    expect(screen.queryByRole("link", { name: "Social" })).toBeNull();
  });
});
