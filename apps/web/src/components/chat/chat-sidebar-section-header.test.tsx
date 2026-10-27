import { fireEvent, render, screen, within } from "@testing-library/react";
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
import { SidebarSectionContent } from "@/components/ui/sidebar-section";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
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
            <SidebarSectionContent>rooms</SidebarSectionContent>
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

  it("puts the chevron after the title", () => {
    render(<Section />);
    const heading = screen.getByRole("button", { name: "Channels" });
    const title = within(heading).getByText("Channels");
    const chevron = heading.querySelector("svg");

    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(
      title.compareDocumentPosition(chevron as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the chevron on hover and focus, and keeps it turned while closed", () => {
    // Hover, focus and the closed turn are CSS states happy-dom cannot
    // compute, so the classes on the chevron are the contract.
    render(<Section />);
    const chevron = screen
      .getByRole("button", { name: "Channels" })
      .querySelector("svg");
    const classes = chevron?.getAttribute("class")?.split(/\s+/) ?? [];

    expect(classes).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-hover/section:opacity-100",
        "group-focus-visible/section:opacity-100",
        "group-data-[state=closed]/section:opacity-100",
        "group-data-[state=closed]/section:-rotate-90",
        "motion-reduce:transition-opacity",
      ]),
    );
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
