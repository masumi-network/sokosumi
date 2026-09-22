import { fireEvent, render, screen } from "@testing-library/react";
import { Hash } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const catalog: Record<string, string> = {
      "App.Channels.RoomUnread.railUnread": "Unread",
      "App.Channels.RoomMentions.railMention": "Mentions you",
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
    <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <Collapsible open={open} onOpenChange={setOpen}>
            <ChatSidebarSectionHeader
              isOpen={open}
              railIcon={Hash}
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
    // The pill is decorative; the heading name carries the room row's string.
    expect(
      screen.getAllByRole("button", { name: "Channels Mentions you" }),
    ).toHaveLength(2);

    rerender(<Section key="open" closedAttention="mention" />);
    expect(
      container.querySelector('[data-slot="room-rail-attention"]'),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: "Channels" })).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Channels Mentions you" }),
    ).toBeNull();
  });

  it("announces unread on a closed heading the same way", () => {
    render(<Section defaultOpen={false} closedAttention="unread" />);

    expect(
      screen.getAllByRole("button", { name: "Channels Unread" }),
    ).toHaveLength(2);
  });
});

/**
 * Archived is the one section whose rows never reach the rail: they are
 * static, and Restore and Delete live in a menu no 32px square has room for
 * (Rail actions, CONTEXT.md). Its square still stands where its heading
 * stands, so the Direct Messages under it keep their place on a toggle — and
 * pressing it expands the sidebar to where those rows are, the way a pending
 * invitation's tile does, rather than dimming a square over nothing.
 */
describe("ChatSidebarSectionHeader rail square that expands the sidebar", () => {
  function ExpandingSection({ onRailPress }: { onRailPress: () => void }) {
    const [open, setOpen] = useState(false);

    return (
      <SidebarProvider defaultOpen={false}>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <Collapsible open={open} onOpenChange={setOpen}>
              <ChatSidebarSectionHeader
                isOpen={open}
                railIcon={Hash}
                onRailPress={onRailPress}
              >
                Archived channels
              </ChatSidebarSectionHeader>
              <ChatSidebarSectionContent>rooms</ChatSidebarSectionContent>
            </Collapsible>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    );
  }

  it("runs the caller's press instead of toggling the section in place", () => {
    const onRailPress = vi.fn();
    const { container } = render(
      <ExpandingSection onRailPress={onRailPress} />,
    );
    const square = railHeader(container)?.querySelector("button");

    expect(square).not.toBeNull();
    // Not a `CollapsibleTrigger`: opening in place would dim the square and
    // show nothing, because the rows are hidden on the rail either way. The
    // `aria-controls` a trigger carries is how that shows; the `data-state`
    // on this button is the tooltip trigger's, not the collapsible's.
    expect(square?.getAttribute("aria-controls")).toBeNull();

    fireEvent.click(square as HTMLButtonElement);
    expect(onRailPress).toHaveBeenCalledTimes(1);
    // The section is the caller's to open, not this button's.
    expect(screen.queryByText("rooms")).toBeNull();
  });

  it("moves focus to the expanded heading, which the press has just revealed", () => {
    const { container } = render(<ExpandingSection onRailPress={vi.fn()} />);
    const square = railHeader(container)?.querySelector("button");

    fireEvent.click(square as HTMLButtonElement);

    // The square the reader pressed is `display: none` once the sidebar
    // expands, and a hidden button drops a keyboard reader on the body.
    expect(document.activeElement).toBe(
      container.querySelector('[data-slot="collapsible-trigger"]'),
    );
  });

  it("keeps the shared slot and the section's name on the square", () => {
    const { container } = render(<ExpandingSection onRailPress={vi.fn()} />);
    const square = railHeader(container)?.querySelector("button");

    expect(
      square?.querySelector('[data-slot="sidebar-row-slot"]'),
    ).not.toBeNull();
    expect(square?.textContent).toContain("Archived channels");
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

  it("widens the clip box by the gutter a room's rail pill sits in", () => {
    const { container } = render(<Section />);
    const classes =
      container
        .querySelector('[data-slot="collapsible-content"]')
        ?.className.split(/\s+/) ?? [];

    // `RailAttentionPill` is at `-left-2`, outside the rows' box.
    expect(classes).toContain("-mx-2");
    expect(classes).toContain("px-2");
  });

  it("heightens the clip box by the rail ring the first and last row wear", () => {
    // Regression: the rows fill the box top to bottom, so the clip used to
    // land on the outermost row's own edge and cut the collapsed rail's
    // `ring-2` there — the last room in a section rendered open-bottomed on
    // hover. The margin/padding pair cancels out, so nothing else moves.
    const { container } = render(<Section />);
    const classes =
      container
        .querySelector('[data-slot="collapsible-content"]')
        ?.className.split(/\s+/) ?? [];

    // In `px`, not on the spacing scale: the ring is a fixed 2px, and
    // `0.125rem` falls under it below a 16px root.
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
