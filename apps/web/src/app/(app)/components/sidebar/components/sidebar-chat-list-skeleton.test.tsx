import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { SidebarChatListSkeleton } from "@/app/components/sidebar/components/sidebar-chat-list-skeleton";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderSkeleton(props?: { hasOrganization: boolean }) {
  return render(
    <SidebarProvider defaultOpen>
      <SidebarChatListSkeleton {...props} />
    </SidebarProvider>,
  );
}

function sectionTitleWidths(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll('[data-slot="sidebar-group-content"] > div'),
  ].map(
    (header) =>
      header
        .querySelectorAll('[data-slot="skeleton"]')[0]
        ?.className.split(/\s+/)
        .find((token) => token.startsWith("w-")) ?? "",
  );
}

/**
 * The real list gates Channels on `hasOrganization`, so a personal workspace
 * has Directs alone. A placeholder that drew Channels there would hand the
 * reader a heading and three rows that vanish when the list lands, moving the
 * Directs under them — the jump this skeleton exists to avoid.
 */
describe("SidebarChatListSkeleton", () => {
  it("draws Channels over Direct Messages in an organization", () => {
    const { container } = renderSkeleton({ hasOrganization: true });

    expect(sectionTitleWidths(container)).toEqual(["w-16", "w-24"]);
    expect(
      container.querySelectorAll('[data-slot="sidebar-menu-item"]'),
    ).toHaveLength(6);
  });

  it("starts a heading with its title, as the real heading does", () => {
    // The real heading's chevron trails the title and hides at rest, so a
    // leading mark here would be one the heading never shows.
    const { container } = renderSkeleton({ hasOrganization: true });
    const headers = container.querySelectorAll(
      '[data-slot="sidebar-group-content"] > div',
    );

    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header.querySelector('[data-slot="sidebar-row-slot"]')).toBeNull();
      expect(header.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1);
    }
  });

  it("drops the Channels section in a personal workspace", () => {
    const { container } = renderSkeleton({ hasOrganization: false });

    // The Direct Messages heading keeps its own width rather than sliding up
    // into the Channels one, so the section that stays is the section that
    // arrives.
    expect(sectionTitleWidths(container)).toEqual(["w-24"]);
    expect(
      container.querySelectorAll('[data-slot="sidebar-menu-item"]'),
    ).toHaveLength(3);
    // Directs are faces; a `rounded-full` mark on every row is how this test
    // says the rows that remain are the Direct ones.
    for (const row of container.querySelectorAll(
      '[data-slot="sidebar-menu-item"]',
    )) {
      expect(
        row.querySelector(
          '[data-slot="sidebar-row-slot"] [data-slot="skeleton"]',
        )?.className,
      ).toContain("rounded-full");
    }
  });

  it("keeps Channels when no caller says otherwise", () => {
    // The boot shell has no session and so cannot know which workspace this
    // is. Most readers are in an organization, so the default draws one.
    const { container } = renderSkeleton();

    expect(sectionTitleWidths(container)).toEqual(["w-16", "w-24"]);
  });

  // The real list is one block under its Chats heading, which every reader
  // has, so the placeholder holds the heading's row above the sections: the
  // sections land where they will be, not one row higher.
  it.each([true, false])(
    "heads the sections with the Chats heading's row (organization: %s)",
    (hasOrganization) => {
      const { container } = renderSkeleton({ hasOrganization });
      const group = container.querySelector('[data-slot="sidebar-group"]');
      const [heading, sections] = [...(group?.children ?? [])];

      expect(sections).toHaveAttribute("data-slot", "sidebar-group-content");
      expect(heading?.className.split(/\s+/)).toEqual(
        expect.arrayContaining(["px-2", "gap-2", "h-11", "md:h-7"]),
      );
      const bars = heading?.querySelectorAll('[data-slot="skeleton"]') ?? [];
      expect(bars).toHaveLength(1);
      expect(bars[0]?.className.split(/\s+/)).toContain("w-10");
    },
  );
});
