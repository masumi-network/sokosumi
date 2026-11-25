import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/tasks" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock(
  "@/app/components/workspace-switcher/workspace-switcher-menu.client",
  () => ({
    default: ({ placement }: { placement: string }) => (
      <button type="button" data-placement={placement}>
        Acme
      </button>
    ),
  }),
);
vi.mock("@/app/components/header/header-trailing-tools", () => ({
  HeaderTrailingTools: () => <button type="button">Notifications</button>,
}));

import HeaderProfileSection from "@/app/components/header/header-profile-section";

function tokens(element: Element | null | undefined): string[] {
  return (element?.className ?? "").split(/\s+/).filter(Boolean);
}

describe("HeaderProfileSection", () => {
  beforeEach(() => {
    mocks.pathname = "/tasks";
  });

  // From md the switcher is the sidebar header's, and hides with it: the
  // desktop top bar ends in Search and the bell.
  it("shows the top-bar Workspace switcher on mobile and collapsed desktop", () => {
    render(<HeaderProfileSection />);

    const switcher = screen.getByRole("button", { name: "Acme" });
    expect(switcher).toHaveAttribute("data-placement", "topBar");
    expect(tokens(switcher.parentElement)).toEqual(
      expect.arrayContaining(["max-md:flex", "md:sidebar-hidden:flex"]),
    );
  });

  it("keeps Notification Center on every width", () => {
    render(<HeaderProfileSection />);

    const bell = screen.getByRole("button", { name: "Notifications" });
    for (let node = bell.parentElement; node; node = node.parentElement) {
      expect(tokens(node)).not.toContain("md:hidden");
    }
  });

  // A project's own pages give the scope chip the row; You keeps the switcher.
  it("reserves room for the mobile project scope on project pages", () => {
    mocks.pathname = "/projects/p-1/memory";
    render(<HeaderProfileSection />);

    expect(
      tokens(screen.getByRole("button", { name: "Acme" }).parentElement),
    ).not.toContain("max-md:flex");
    expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible();
  });
});
