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
        .querySelectorAll('[data-slot="skeleton"]')[1]
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
});
