import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRowSlot,
} from "@/components/ui/sidebar";

function renderSidebar({ open }: { open: boolean }) {
  return render(
    <SidebarProvider defaultOpen={open}>
      <Sidebar>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <SidebarRowSlot>
                  <svg aria-hidden />
                </SidebarRowSlot>
                <span>Tasks</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>,
  );
}

function tokens(element: Element | null | undefined): string[] {
  return (element?.className ?? "").split(/\s+/).filter(Boolean);
}

/**
 * The sidebar hides completely rather than collapsing to an icon rail, so a
 * hidden sidebar hands the page its whole width.
 */
describe("Sidebar hidden", () => {
  it("is off-canvas, with no rail left beside the page", () => {
    const { container } = renderSidebar({ open: false });
    const sidebar = container.querySelector('[data-slot="sidebar"]');

    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
    expect(sidebar?.getAttribute("data-collapsible")).toBe("offcanvas");
    // The gap that reserves the panel's width in the page goes to nothing,
    // and the panel slides past the window's edge.
    expect(
      tokens(container.querySelector('[data-slot="sidebar-gap"]')),
    ).toContain("group-data-[collapsible=offcanvas]:w-0");
    expect(
      tokens(container.querySelector('[data-slot="sidebar-container"]')),
    ).toContain(
      "group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]",
    );
  });

  it("keeps no rail-only rule anywhere in its markup", () => {
    const { container } = renderSidebar({ open: false });

    expect(container.innerHTML).not.toContain("collapsible=icon");
    expect(container.innerHTML).not.toContain("sidebar-width-icon");
  });

  it("drops the travel under prefers-reduced-motion", () => {
    const { container } = renderSidebar({ open: true });

    for (const selector of [
      '[data-slot="sidebar-gap"]',
      '[data-slot="sidebar-container"]',
    ]) {
      const classes = tokens(container.querySelector(selector));
      expect(classes, selector).toContain("duration-200");
      expect(classes, selector).toContain("ease-linear");
      expect(classes, selector).toContain("motion-reduce:transition-none");
    }
  });
});

/**
 * The **Sidebar row** rule (GLOSSARY.md), at the primitive that owns it, so a
 * new kind of row cannot drift from it.
 */
describe("Sidebar row geometry", () => {
  it("is 28px with a pointer and 44px on a phone", () => {
    const { container } = renderSidebar({ open: true });
    const button = tokens(
      container.querySelector('[data-slot="sidebar-menu-button"]'),
    );

    expect(button).toContain("h-11");
    expect(button).toContain("md:h-7");
    expect(button).not.toContain("md:h-8");
  });

  it("holds a two-line row to at least one row's height", () => {
    const { container } = renderSidebar({ open: true });
    const button = tokens(
      container.querySelector('[data-slot="sidebar-menu-button"]'),
    );

    // A two-line row releases the height with `h-auto md:h-auto` and keeps
    // this floor, so it never has to name a height of its own.
    expect(button).toContain("min-h-11");
    expect(button).toContain("md:min-h-7");
  });

  it("puts the mark in one 24px slot on one axis", () => {
    const { container } = renderSidebar({ open: true });
    const button = tokens(
      container.querySelector('[data-slot="sidebar-menu-button"]'),
    );
    const slot = tokens(
      container.querySelector('[data-slot="sidebar-row-slot"]'),
    );

    // 8px of group padding plus the row's own 8px puts the 24px slot 16px in
    // — centred 28px from the sidebar's left edge — and the label at 48px.
    expect(button).toContain("px-2");
    expect(button).toContain("gap-2");
    // A minimum, not a fixed width: a group Direct's stack of faces grows the
    // box to the right off the same left edge, so the first face stays on the
    // axis and only that row's name starts later.
    expect(slot).toEqual(
      expect.arrayContaining(["h-6", "min-w-6", "shrink-0"]),
    );
    expect(slot).not.toContain("size-6");
  });

  it("sizes the row's icon: 14px with a pointer, 16px on a phone", () => {
    const { container } = renderSidebar({ open: true });
    const slot = tokens(
      container.querySelector('[data-slot="sidebar-row-slot"]'),
    );

    // The slot sizes a bare icon, so a list passes one without a size of its
    // own. `:where()` takes the rule's specificity to zero: a mark that does
    // name its own size (a 20px face, a disclosure chevron) keeps it, and
    // only an svg that names none takes the row's.
    expect(slot).toContain("[:where(&>svg)]:size-4");
    expect(slot).toContain("md:[:where(&>svg)]:size-3.5");
  });
});
