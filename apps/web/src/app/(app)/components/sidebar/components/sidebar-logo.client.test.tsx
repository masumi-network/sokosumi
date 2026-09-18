import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ state: "collapsed", toggleSidebar: vi.fn() }),
}));

vi.mock("@/components/masumi-logos", () => ({
  SokosumiIcon: () => <svg aria-hidden />,
  SokosumiLogo: () => <svg aria-hidden />,
  ThemedLogo: () => <svg aria-hidden />,
}));

import SidebarLogo from "./sidebar-logo.client";

function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

// The logo is the one rail control not built on `SidebarMenuButton`, so it
// restates the rail's hover by hand: a ring on transparent, deepened on
// press, in the same 32px square as every other rail item.
describe("SidebarLogo on the collapsed rail", () => {
  it("hovers as a ring, not a fill", () => {
    render(<SidebarLogo />);
    const button = screen.getByRole("button", { name: "expandSidebar" });
    const classes = tokens(button.className);
    expect(classes).toEqual(
      expect.arrayContaining([
        "size-8",
        "rounded-md",
        "ring-sidebar-ring",
        "hover:ring-1",
        "active:ring-2",
      ]),
    );
    expect(classes).not.toContain("hover:bg-sidebar-accent");
  });
});
