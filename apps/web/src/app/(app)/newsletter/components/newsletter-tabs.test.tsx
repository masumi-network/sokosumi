import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NewsletterTabs } from "./newsletter-tabs";

const mocks = vi.hoisted(() => ({ pathname: "/newsletter/issues" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

const TABS = [
  { id: "issues", href: "/newsletter/issues?projectId=p1", label: "Issues" },
  {
    id: "calendar",
    href: "/calendar?types=newsletter&projectId=p1",
    label: "Calendar",
  },
  {
    id: "settings",
    href: "/newsletter/settings?projectId=p1",
    label: "Settings",
  },
];

describe("NewsletterTabs", () => {
  const scrollIntoView = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    mocks.pathname = "/newsletter/issues";
    scrollIntoView.mockClear();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = original;
  });

  it("renders the sections as links in the segmented switch, not an underline", () => {
    render(<NewsletterTabs ariaLabel="Newsletter sections" tabs={TABS} />);

    const nav = screen.getByRole("navigation", { name: "Newsletter sections" });
    expect(nav).toHaveClass("bg-card-background", "rounded-lg", "w-fit");
    expect(nav).toHaveClass("overflow-x-auto");
    expect(nav).not.toHaveClass("border-b");
    expect(screen.queryByRole("tablist")).toBeNull();

    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "href",
      "/calendar?types=newsletter&projectId=p1",
    );
    // A row that scrolls must not squeeze its labels onto two lines instead.
    expect(screen.getByRole("link", { name: "Issues" })).toHaveClass(
      "shrink-0",
      "whitespace-nowrap",
    );
  });

  it("marks only the current section active", () => {
    render(<NewsletterTabs ariaLabel="Newsletter sections" tabs={TABS} />);

    const issues = screen.getByRole("link", { name: "Issues" });
    expect(issues).toHaveAttribute("aria-current", "page");
    expect(issues).toHaveAttribute("data-state", "active");

    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings).not.toHaveAttribute("aria-current");
    expect(settings).toHaveAttribute("data-state", "inactive");
  });

  it("keeps Issues active on an issue's own page", () => {
    mocks.pathname = "/newsletter/issues/issue-1";
    render(<NewsletterTabs ariaLabel="Newsletter sections" tabs={TABS} />);

    expect(screen.getByRole("link", { name: "Issues" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("scrolls the active section into view, and only that one", () => {
    mocks.pathname = "/newsletter/settings";
    render(<NewsletterTabs ariaLabel="Newsletter sections" tabs={TABS} />);

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "nearest",
      inline: "nearest",
    });
    expect(scrollIntoView.mock.contexts[0]).toBe(
      screen.getByRole("link", { name: "Settings" }),
    );
  });
});
