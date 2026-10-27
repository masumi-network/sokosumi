import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const catalog: Record<string, string> = {
      "App.Channels.RoomUnread.unread": "Unread",
      "App.Channels.RoomMentions.mentionsYou": "Mentions you",
    };
    return catalog[`${namespace ?? ""}.${key}`] ?? key;
  },
}));

import { Collapsible } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  ChatSidebarSectionContent,
  ChatSidebarSectionHeader,
} from "./chat-sidebar-section-header";
import type { SectionAttention } from "./room-attention";

function Section({
  defaultOpen = true,
  closedAttention = null,
}: {
  defaultOpen?: boolean;
  closedAttention?: SectionAttention;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <SidebarProvider defaultOpen>
      <Sidebar>
        <SidebarContent>
          <Collapsible open={open} onOpenChange={setOpen}>
            <ChatSidebarSectionHeader
              isOpen={open}
              closedAttention={closedAttention}
            >
              Channels
            </ChatSidebarSectionHeader>
            <ChatSidebarSectionContent>rooms</ChatSidebarSectionContent>
          </Collapsible>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

describe("ChatSidebarSectionHeader", () => {
  it("opens and closes the section from its one heading", () => {
    render(<Section />);
    const heading = screen.getByRole("button", { name: "Channels" });
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("rooms")).toBeInTheDocument();

    fireEvent.click(heading);

    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("rooms")).not.toBeInTheDocument();
  });

  it("marks a closed section that holds something, and an open one never", () => {
    const { rerender } = render(
      <Section defaultOpen={false} closedAttention="mention" />,
    );
    const closed = screen.getByRole("button", {
      name: "Channels Mentions you",
    });
    expect(closed.className).toContain("font-semibold");

    rerender(<Section key="open" closedAttention="mention" />);
    expect(screen.getByRole("button", { name: "Channels" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Channels Mentions you" }),
    ).toBeNull();
  });

  it("announces unread on a closed heading the same way", () => {
    render(<Section defaultOpen={false} closedAttention="unread" />);

    expect(
      screen.getByRole("button", { name: "Channels Unread" }),
    ).toBeInTheDocument();
  });
});

describe("ChatSidebarSectionContent", () => {
  it("slides on the same motion as the Projects disclosure", () => {
    const { container } = render(<Section />);
    const content = container.querySelector(
      '[data-slot="collapsible-content"]',
    );
    const classes = content?.className.split(/\s+/) ?? [];

    expect(classes).toContain(
      "motion-safe:data-[state=open]:animate-collapsible-down",
    );
    expect(classes).toContain(
      "motion-safe:data-[state=closed]:animate-collapsible-up",
    );
    expect(classes).toContain("overflow-hidden");
  });

  it("lets a caller drop the clip, which Pinned needs while its rows drag", () => {
    // `cn` is `twMerge`, so the caller's `overflow-visible` has to win
    // outright rather than land beside `overflow-hidden` and lose to it.
    const { container } = render(
      <Collapsible open>
        <ChatSidebarSectionContent className="overflow-visible">
          rooms
        </ChatSidebarSectionContent>
      </Collapsible>,
    );
    const classes =
      container
        .querySelector('[data-slot="collapsible-content"]')
        ?.className.split(/\s+/) ?? [];

    expect(classes).toContain("overflow-visible");
    expect(classes).not.toContain("overflow-hidden");
  });

  it("grows the clip box by the focus ring the outermost rows wear", () => {
    // The rows fill the box edge to edge, so without this the clip lands on
    // a row's own edge and cuts its `ring-2`. The margin/padding pairs cancel
    // out, so nothing else moves. In `px`, not on the spacing scale: the ring
    // is a fixed 2px, and `0.125rem` falls under it below a 16px root.
    const { container } = render(<Section />);
    const classes =
      container
        .querySelector('[data-slot="collapsible-content"]')
        ?.className.split(/\s+/) ?? [];

    expect(classes).toContain("-mx-2");
    expect(classes).toContain("px-2");
    expect(classes).toContain("-my-[2px]");
    expect(classes).toContain("py-[2px]");
  });

  it("leaves the strip it grew into to the heading it overlaps", () => {
    // The negative top margin puts 2px of this box over the bottom of the
    // heading above, which paints earlier and would lose those hits. The box
    // takes no pointer events and hands them back on its rows, which start
    // inside the padding.
    const { container } = render(<Section />);
    const classes =
      container
        .querySelector('[data-slot="collapsible-content"]')
        ?.className.split(/\s+/) ?? [];

    expect(classes).toContain("pointer-events-none");
    expect(classes).toContain("[&>*]:pointer-events-auto");
  });
});
