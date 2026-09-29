import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { activeProjectTabId, ProjectTabs } from "./project-tabs";

const pathname = vi.hoisted(() => ({ current: "/projects/p1" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

const TABS = [
  { id: "overview", href: "/projects/p1", label: "Overview", exact: true },
  { id: "studio", href: "/projects/p1/studio", label: "Image studio" },
  { id: "calendar", href: "/projects/p1/calendar", label: "Calendar" },
];

describe("activeProjectTabId", () => {
  it("picks the longest matching tab, not the first", () => {
    // Overview's href is a prefix of every other tab's, so a first-match
    // rule would light up Overview on every subpage.
    expect(activeProjectTabId("/projects/p1/studio", TABS)).toBe("studio");
    expect(activeProjectTabId("/projects/p1", TABS)).toBe("overview");
  });

  it("keeps a tab lit below its own route", () => {
    expect(activeProjectTabId("/projects/p1/calendar/2026-09", TABS)).toBe(
      "calendar",
    );
  });

  it("lights nothing on a route that is not a tab", () => {
    expect(activeProjectTabId("/projects/p1/edit", TABS)).toBeNull();
    expect(activeProjectTabId("/tasks", TABS)).toBeNull();
  });

  it("does not match a sibling project whose id merely starts the same", () => {
    expect(activeProjectTabId("/projects/p10/studio", TABS)).toBeNull();
  });
});

describe("ProjectTabs", () => {
  it("marks only the current tab for assistive technology", () => {
    pathname.current = "/projects/p1/studio";
    render(<ProjectTabs ariaLabel="Project sections" tabs={TABS} />);

    expect(screen.getByRole("link", { name: "Image studio" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("does not clip the active tab's underline", () => {
    // The row carries the rule and the active tab overlaps it by a pixel, so
    // the tab is taller than the row. Making the row a horizontal scroller
    // also made it an `overflow-y: auto` box, which clipped exactly that
    // pixel and offered a vertical scrollbar for three words.
    pathname.current = "/projects/p1/studio";
    const { container } = render(
      <ProjectTabs ariaLabel="Project sections" tabs={TABS} />,
    );

    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("border-b");
    expect(nav?.className).not.toContain("overflow-");
    expect(container.querySelector("ul")?.className).toContain("flex-wrap");
    expect(
      screen.getByRole("link", { name: "Image studio" }).className,
    ).toContain("-mb-px");
  });

  it("renders real links, so a tab can be opened in a new window", () => {
    pathname.current = "/projects/p1";
    render(<ProjectTabs ariaLabel="Project sections" tabs={TABS} />);

    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "href",
      "/projects/p1/calendar",
    );
  });
});
