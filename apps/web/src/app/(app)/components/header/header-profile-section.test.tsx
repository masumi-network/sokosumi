import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  // From md the switcher is the sidebar header's, and hides with it: the
  // desktop top bar ends in Search and the bell.
  it("keeps the Workspace switcher for the phone only", () => {
    render(<HeaderProfileSection />);

    const switcher = screen.getByRole("button", { name: "Acme" });
    expect(switcher).toHaveAttribute("data-placement", "topBar");
    expect(tokens(switcher.parentElement)).toContain("md:hidden");
  });

  it("keeps Notification Center on every width", () => {
    render(<HeaderProfileSection />);

    const bell = screen.getByRole("button", { name: "Notifications" });
    for (let node = bell.parentElement; node; node = node.parentElement) {
      expect(tokens(node)).not.toContain("md:hidden");
    }
  });
});
