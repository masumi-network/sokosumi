import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@/components/ui/sidebar";

/**
 * Regression: the icon rail used to set `overflow-hidden` on SidebarContent,
 * which made channels/DMs below the fold unreachable when the sidebar was
 * collapsed. It has to stay vertically scrollable in both states.
 */
describe("SidebarContent in the collapsed icon rail", () => {
  it("keeps vertical scrolling enabled", () => {
    const { container } = render(
      <SidebarProvider defaultOpen={false}>
        <Sidebar collapsible="icon">
          <SidebarContent />
        </Sidebar>
      </SidebarProvider>,
    );

    const content = container.querySelector('[data-slot="sidebar-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain("overflow-y-auto");
    expect(content?.className).toContain(
      "group-data-[collapsible=icon]:[scrollbar-width:none]",
    );
    expect(content?.className).not.toMatch(
      /collapsible=icon\]:overflow-hidden/,
    );
  });
});
