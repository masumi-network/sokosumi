import { fireEvent, render, screen } from "@testing-library/react";
import { Hash } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
import type { SectionAttention } from "./room-attention";

function Section({
  defaultOpen = true,
  closedAttention = null,
  withRailIcon = true,
}: {
  defaultOpen?: boolean;
  closedAttention?: SectionAttention;
  withRailIcon?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <Collapsible open={open} onOpenChange={setOpen}>
            <ChatSidebarSectionHeader
              isOpen={open}
              railIcon={withRailIcon ? Hash : undefined}
              closedAttention={closedAttention}
            >
              Channels
            </ChatSidebarSectionHeader>
            <CollapsibleContent>rooms</CollapsibleContent>
          </Collapsible>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

function railHeader(container: HTMLElement) {
  return container.querySelector('[data-slot="section-rail-header"]');
}

describe("ChatSidebarSectionHeader on the collapsed rail", () => {
  it("keeps a named square that CSS shows only on the rail", () => {
    const { container } = render(<Section />);

    expect(railHeader(container)?.className).toContain(
      "group-data-[collapsible=icon]:block",
    );
    expect(railHeader(container)?.className).toContain("hidden");
    // Both headings carry the name; the rail's is the icon square.
    expect(screen.getAllByRole("button", { name: "Channels" })).toHaveLength(2);
  });

  it("opens and closes the section from the rail", () => {
    const { container } = render(<Section />);
    const railButton = railHeader(container)?.querySelector("button");
    expect(railButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("rooms")).toBeInTheDocument();

    fireEvent.click(railButton as HTMLElement);

    expect(railButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("rooms")).not.toBeInTheDocument();
    expect(railButton?.className).toContain("opacity-60");
  });

  it("marks a closed section that holds something, and an open one never", () => {
    const { container, rerender } = render(
      <Section defaultOpen={false} closedAttention="mention" />,
    );
    expect(
      container
        .querySelector('[data-slot="room-rail-attention"]')
        ?.getAttribute("data-variant"),
    ).toBe("mention");

    rerender(<Section key="open" closedAttention="mention" />);
    expect(
      container.querySelector('[data-slot="room-rail-attention"]'),
    ).toBeNull();
  });

  it("stays off the rail without an icon, as Archived does", () => {
    const { container } = render(<Section withRailIcon={false} />);

    expect(railHeader(container)).toBeNull();
  });
});
