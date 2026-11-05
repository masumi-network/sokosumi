import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NewsletterPageShell } from "./newsletter-page-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/newsletter/issues",
}));

const TABS = [
  { id: "issues", href: "/newsletter/issues?projectId=p1", label: "Issues" },
  {
    id: "settings",
    href: "/newsletter/settings?projectId=p1",
    label: "Settings",
  },
];

describe("NewsletterPageShell", () => {
  it("opens on the switch, with the page title for screen readers only", () => {
    const { container } = render(
      <NewsletterPageShell
        navigationLabel="Newsletter sections"
        tabs={TABS}
        title="Newsletter"
      >
        <p>Content</p>
      </NewsletterPageShell>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("sr-only");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(container.querySelector("header")).toBeNull();

    const nav = screen.getByRole("navigation", { name: "Newsletter sections" });
    expect(nav.parentElement?.firstElementChild).toBe(nav);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("leaves the switch out while there is only one section", () => {
    render(
      <NewsletterPageShell
        navigationLabel="Newsletter sections"
        tabs={TABS.slice(1)}
        title="Newsletter"
      >
        <p>Content</p>
      </NewsletterPageShell>,
    );

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });
});
