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
  SidebarRailSelectionBar,
  SidebarRowSlot,
} from "@/components/ui/sidebar";

/**
 * Collapsed to icons, rest, hover and selection all used to render the same
 * colour: `--muted`, `--accent` and `--sidebar-accent` are one value in dark,
 * so a Channel tile's own plate, the hover wash and the active wash landed on
 * 15% alike and only the box grew. The fill is hover's alone now, as a ring,
 * and selection is the rail's right edge. Every rail item shares both, so the
 * rules live on the primitive rather than in each list that draws rows.
 */
function renderRail(ui: React.ReactNode) {
  return render(
    <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <SidebarMenu>{ui}</SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>,
  );
}

describe("SidebarMenuButton in the collapsed icon rail", () => {
  it("hands the fill to hover, as a ring, and takes it off both states", () => {
    const { container } = renderRail(
      <SidebarMenuItem>
        <SidebarMenuButton isActive>Tasks</SidebarMenuButton>
      </SidebarMenuItem>,
    );
    const button = container.querySelector(
      '[data-slot="sidebar-menu-button"]',
    );

    // Neither state paints the rail, or all three land on the one neutral.
    expect(button?.className).toContain(
      "group-data-[collapsible=icon]:hover:bg-transparent",
    );
    expect(button?.className).toContain(
      "group-data-[collapsible=icon]:data-[active=true]:bg-transparent",
    );
    // Hover states itself with a ring, which reads over a filled tile.
    expect(button?.className).toContain(
      "group-data-[collapsible=icon]:hover:ring-1",
    );
    expect(button?.className).toContain(
      "group-data-[collapsible=icon]:hover:ring-sidebar-ring",
    );
    // A press deepens the ring rather than flashing the fill, so the colour
    // this rail stopped reading never appears on it at all.
    expect(button?.className).toContain(
      "group-data-[collapsible=icon]:active:bg-transparent",
    );
    expect(button?.className).toContain(
      "group-data-[collapsible=icon]:active:ring-2",
    );
    // The ring hugs a 32px square: a 40px minimum width used to stretch it
    // 8px wider than the logo's and the account chip's, so the same hover
    // drew three different boxes down one rail. Height is no longer part of
    // that override — the row is 32px at `md` in both states now, and the
    // rail only exists at `md` — so the rail sets width alone.
    expect(button?.className).toContain("group-data-[collapsible=icon]:w-8!");
    expect(button?.className).not.toContain("min-w-10");
    // And centres what it holds: a 12px left pad only centred a 16px icon
    // while the box was 40px wide.
    expect(button?.className).toContain(
      "group-data-[collapsible=icon]:justify-center",
    );
    expect(button?.className).toContain("group-data-[collapsible=icon]:px-0!");
    expect(button?.className).not.toContain("p-3!");
    // Expanded, the fill still carries all three, so those rules stay.
    expect(button?.className).toContain("hover:bg-sidebar-accent");
    expect(button?.className).toContain("active:bg-sidebar-accent");
    expect(button?.className).toContain(
      "data-[active=true]:bg-sidebar-accent",
    );
  });
});

describe("SidebarRailSelectionBar", () => {
  it("marks the open item on the rail's right edge, collapsed only", () => {
    const { container } = renderRail(
      <SidebarMenuItem>
        <SidebarMenuButton isActive>Tasks</SidebarMenuButton>
        <SidebarRailSelectionBar />
      </SidebarMenuItem>,
    );
    const bar = container.querySelector(
      '[data-slot="sidebar-rail-selection"]',
    );

    expect(bar).not.toBeNull();
    // Rendered always, shown only collapsed, like Chat's attention pill.
    expect(bar?.className).toContain("hidden");
    expect(bar?.className).toContain("group-data-[collapsible=icon]:block");
    // The opposite edge from that pill's `-left-2`, and longer than either of
    // its variants, so it answers "which row is open" from the corner of the
    // eye rather than "this room wants you".
    expect(bar?.className).toContain("-right-2");
    expect(bar?.className).toContain("h-5");
    expect(bar?.className).toContain("bg-primary-solid");
    // Decorative: `aria-current` on the item already states it.
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
  });
});

/**
 * The **Sidebar row** rule (CONTEXT.md), at the primitive that owns it. Rows
 * used to be a 40px minimum expanded and a 32px square on the rail, so every
 * row above the first Chat room pushed the list down on a toggle; and each
 * list built its own leading box by hand, which is how a room's mark ended up
 * 2px off the nav icons' line. One height and one slot, here, so a new kind
 * of row cannot drift from either.
 */
describe("Sidebar row geometry", () => {
  function buttonIn(state: "expanded" | "collapsed") {
    const { container } = render(
      <SidebarProvider defaultOpen={state === "expanded"}>
        <Sidebar collapsible="icon">
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
    return container.querySelector('[data-slot="sidebar-menu-button"]');
  }

  it("is one height in both states: 32px with a pointer, 44px on a phone", () => {
    const expanded = buttonIn("expanded")?.className ?? "";
    const collapsed = buttonIn("collapsed")?.className ?? "";

    // The phone sheet is never the rail, so a thumb keeps its 44px target.
    for (const className of [expanded, collapsed]) {
      expect(className.split(" ")).toContain("h-11");
      expect(className.split(" ")).toContain("md:h-8");
      // The 40px floor the row inherited from a removed hover-to-expand
      // feature, and the rail square that disagreed with it.
      expect(className).not.toContain("min-h-10");
      expect(className).not.toContain("group-data-[collapsible=icon]:size-8!");
    }
    // Both states render one element, so the rule cannot differ between them.
    expect(expanded).toBe(collapsed);
  });

  it("puts the mark in one 24px slot on one axis in both states", () => {
    const className = buttonIn("expanded")?.className ?? "";

    // 8px of group padding plus the row's own 8px puts the 24px slot 16px in
    // — centred 28px from the sidebar's left edge — and the label at 48px.
    expect(className.split(" ")).toContain("px-2");
    expect(className.split(" ")).toContain("gap-2");
    // On the rail the padding drops and the 32px square's own 4px offset puts
    // the same slot on the same line. `mx-auto` would centre it on the rail's
    // own centre, which the 1px right border leaves on a half pixel.
    expect(className).toContain("group-data-[collapsible=icon]:ml-1");
    expect(className).not.toContain("group-data-[collapsible=icon]:mx-auto");
  });

  it("renders the slot at one size, with no state of its own", () => {
    const { container } = render(
      <SidebarProvider defaultOpen>
        <SidebarRowSlot>
          <svg aria-hidden />
        </SidebarRowSlot>
      </SidebarProvider>,
    );
    const slot = container.querySelector('[data-slot="sidebar-row-slot"]');

    expect(slot?.className.split(" ")).toEqual(
      expect.arrayContaining([
        "size-6",
        "shrink-0",
        "items-center",
        "justify-center",
      ]),
    );
    expect(slot?.className).not.toContain("group-data-[collapsible=icon]:");
    expect(slot?.className).not.toContain("md:");
  });
});
