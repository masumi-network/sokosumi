import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import {
  SIDEBAR_BOOT_SCRIPT,
  SIDEBAR_BOOT_STOP_GLOBAL,
} from "@/lib/ui-preferences/sidebar-state";

/**
 * Locks the contract between the pre-paint boot script and the markup `Sidebar`
 * actually renders. The script's own tests build a stand-in node, so they would
 * still pass if `Sidebar` stopped emitting `data-collapsible-mode` — this one
 * drives the real component.
 */
describe("sidebar boot script contract", () => {
  beforeEach(() => {
    document.cookie =
      "sidebar_state=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  function renderExpandedSidebar() {
    // `open` is controlled so the provider's own cookie restore cannot collapse
    // the sidebar; only the boot script gets to change it here.
    const { container } = render(
      <SidebarProvider open onOpenChange={() => {}}>
        <Sidebar collapsible="icon" />
      </SidebarProvider>,
    );

    const sidebar = container.querySelector('[data-slot="sidebar"]');
    if (!sidebar) {
      throw new Error("Sidebar did not render a [data-slot='sidebar'] node.");
    }

    return sidebar;
  }

  it("renders the expanded markup the boot script keys off", () => {
    const sidebar = renderExpandedSidebar();

    expect(sidebar.getAttribute("data-state")).toBe("expanded");
    // Expanded markup blanks data-collapsible, so the mode must ride along
    // separately or the script cannot know what to collapse to.
    expect(sidebar.getAttribute("data-collapsible")).toBe("");
    expect(sidebar.getAttribute("data-collapsible-mode")).toBe("icon");
  });

  it("collapses that markup before React hydrates", () => {
    document.cookie = "sidebar_state=false; path=/";
    const sidebar = renderExpandedSidebar();

    new Function(SIDEBAR_BOOT_SCRIPT)();

    expect(sidebar.getAttribute("data-state")).toBe("collapsed");
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon");

    (
      window as typeof window & { [SIDEBAR_BOOT_STOP_GLOBAL]?: () => void }
    )[SIDEBAR_BOOT_STOP_GLOBAL]?.();
  });
});
