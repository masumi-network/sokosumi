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
    // Expanded, the fill still carries both, so those rules stay.
    expect(button?.className).toContain("hover:bg-sidebar-accent");
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
