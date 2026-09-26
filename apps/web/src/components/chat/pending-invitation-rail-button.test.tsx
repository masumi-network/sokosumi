import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { PendingInvitationRailButton } from "./pending-invitation-rail-button";

const LABEL = "Invitation to Launch Plan from Acme";

function renderRail() {
  return render(
    <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <PendingInvitationRailButton
                roomName="Launch Plan"
                label={LABEL}
                acceptButtonId="accept"
              />
              <button id="accept" type="button">
                Accept
              </button>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>,
  );
}

describe("PendingInvitationRailButton", () => {
  it("shows only on the collapsed rail, named after the invitation", () => {
    renderRail();
    const button = screen.getByRole("button", { name: LABEL });

    expect(button.className).toContain("hidden");
    expect(button.className).toContain("group-data-[collapsible=icon]:flex");
  });

  it("carries the external Channel tile under the mention-weight pill", () => {
    const { container } = renderRail();

    expect(
      container.querySelector('[data-slot="channel-tile"]')?.textContent,
    ).toBe("LP");
    expect(
      container
        .querySelector('[data-slot="room-rail-attention"]')
        ?.getAttribute("data-variant"),
    ).toBe("mention");
  });

  it("expands the sidebar, where Accept and Decline live", () => {
    const { container } = renderRail();
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");

    fireEvent.click(screen.getByRole("button", { name: LABEL }));

    expect(sidebar?.getAttribute("data-state")).toBe("expanded");
  });

  it("hands focus to Accept, because expanding hides the rail button", () => {
    renderRail();

    fireEvent.click(screen.getByRole("button", { name: LABEL }));

    expect(screen.getByRole("button", { name: "Accept" })).toHaveFocus();
  });
});
