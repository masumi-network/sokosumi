import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import {
  SIDEBAR_BOOT_SCRIPT,
  SIDEBAR_BOOT_STOP_GLOBAL,
  SIDEBAR_COMPACT_MEDIA_QUERY,
} from "@/lib/ui-preferences/sidebar-state";

/**
 * Locks the contract between the pre-paint boot script and the markup `Sidebar`
 * actually renders. The script's own tests build a stand-in node, so they would
 * still pass if `Sidebar` stopped emitting `data-collapsible-mode` — this one
 * drives the real component.
 */
describe("sidebar boot script contract", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    document.cookie =
      "sidebar_state=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    (
      window as typeof window & { [SIDEBAR_BOOT_STOP_GLOBAL]?: () => void }
    )[SIDEBAR_BOOT_STOP_GLOBAL]?.();
  });

  /** Answers only the compact query, so a wrong query string fails the test. */
  function setCompactWindow(compact: boolean) {
    window.matchMedia = vi.fn().mockImplementation((media: string) => ({
      matches: media === SIDEBAR_COMPACT_MEDIA_QUERY ? compact : false,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;
  }

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
    setCompactWindow(false);
    const sidebar = renderExpandedSidebar();

    new Function(SIDEBAR_BOOT_SCRIPT)();

    expect(sidebar.getAttribute("data-state")).toBe("collapsed");
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon");
  });

  it("collapses a narrow window with no stored preference", () => {
    setCompactWindow(true);
    const sidebar = renderExpandedSidebar();

    new Function(SIDEBAR_BOOT_SCRIPT)();

    // Otherwise the rail the provider settles on arrives a frame late, which is
    // the expanded-then-collapse flash this script exists to prevent.
    expect(sidebar.getAttribute("data-state")).toBe("collapsed");
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon");
  });

  it("leaves a wide window expanded with no stored preference", () => {
    setCompactWindow(false);
    const sidebar = renderExpandedSidebar();

    new Function(SIDEBAR_BOOT_SCRIPT)();

    expect(sidebar.getAttribute("data-state")).toBe("expanded");
  });

  it("evaluates the same query string the provider subscribes to", () => {
    // The script and `useIsSidebarCompact` used to run the same number through
    // two different APIs. A media query that is merely equivalent is not good
    // enough — at a fractional viewport width the two can disagree, and the
    // disagreement is the flash this script exists to prevent.
    expect(SIDEBAR_BOOT_SCRIPT).toContain(
      JSON.stringify(SIDEBAR_COMPACT_MEDIA_QUERY),
    );
    expect(SIDEBAR_BOOT_SCRIPT).not.toContain("innerWidth");
  });
});
