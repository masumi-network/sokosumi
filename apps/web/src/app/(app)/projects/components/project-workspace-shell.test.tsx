import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectWorkspaceShell } from "@/app/projects/components/project-workspace-shell";

/**
 * The project as one surface.
 *
 * The page used to be a stack of things floating in the app gutter: a title,
 * then a rule with tabs on it, then content, then panels nested inside that.
 * These pin the composition that replaced it — identity, navigation and the
 * active area inside a single card that matches the projects index and Drive.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/p1/memory",
}));

const LABELS = {
  ariaLabel: "Project sections",
  backToProjects: "All projects",
  design: "Design",
  memory: "Memory",
  overview: "Overview",
  social: "Social",
};

function renderShell() {
  return render(
    <ProjectWorkspaceShell
      labels={LABELS}
      metadata={[{ label: "Updated", value: "Today" }]}
      projectId="p1"
      projectName="Example project"
      showSocialTab={false}
    >
      <p>area content</p>
    </ProjectWorkspaceShell>,
  );
}

describe("the project workspace surface", () => {
  it("puts identity, tabs and content inside one card", () => {
    const { container } = renderShell();

    const card = container.querySelector(".bg-card-background");
    expect(card).not.toBeNull();
    // The same card the projects index and Drive draw: hairline border and a
    // radius from `md`, full-bleed and border-free below it.
    expect(card?.className).toContain("md:rounded-xl");
    expect(card?.className).toContain("md:border");
    expect(card?.className).toContain("-mx-4");

    // All three live inside it, which is the whole point.
    expect(card?.contains(screen.getByRole("heading", { level: 1 }))).toBe(
      true,
    );
    expect(card?.contains(screen.getByRole("navigation"))).toBe(true);
    expect(card?.contains(screen.getByText("area content"))).toBe(true);
  });

  it("does not clip its own overflow, so a sticky child can still stick", () => {
    const { container } = renderShell();

    // The studio's assistant column is `position: sticky`, and an ancestor
    // with a clipped overflow silently turns sticky into static.
    expect(
      container.querySelector(".bg-card-background")?.className,
    ).not.toContain("overflow-hidden");
  });

  it("hangs the tab strip on the card's own divider", () => {
    renderShell();

    const nav = screen.getByRole("navigation", { name: "Project sections" });
    // The rule under the tabs is the divider between header and content, not
    // a rule the tabs float above.
    expect(nav.className).toContain("border-b");
    expect(nav.className).not.toContain("-mx-4");
    expect(screen.getByRole("link", { name: "Memory" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("navigates the three views a project actually has, and nothing else", () => {
    renderShell();

    // The studio and the calendar are top-level destinations now: neither is
    // an area *of* a project, so neither is a tab here.
    const tabs = screen
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    expect(tabs).toEqual([
      ["Overview", "/projects/p1"],
      ["Design", "/projects/p1/design-md"],
      ["Memory", "/projects/p1/memory"],
    ]);
  });

  it("adds Social as a fourth tab only inside the beta", () => {
    render(
      <ProjectWorkspaceShell
        labels={LABELS}
        metadata={[]}
        projectId="p1"
        projectName="Example project"
        showSocialTab
      >
        <p>area content</p>
      </ProjectWorkspaceShell>,
    );

    // This row is Social's only navigation, so dropping the tab would strand
    // the route rather than tidy the page.
    expect(screen.getByRole("link", { name: "Social" })).toHaveAttribute(
      "href",
      "/projects/p1/social",
    );
  });

  it("gives the header, the tabs and the content one shared inset", () => {
    const { container } = renderShell();

    const card = container.querySelector(".bg-card-background");
    const insets = [...(card?.children ?? [])].map((child) =>
      (child.className || "").toString(),
    );
    expect(insets).toHaveLength(3);
    for (const cls of insets) {
      expect(cls).toContain("px-4");
      expect(cls).toContain("md:px-6");
    }
  });
});
