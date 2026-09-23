import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { SidebarProvider } from "@/components/ui/sidebar";

import { ChatUnreadNavRows } from "../chat-unread-nav-rows";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));
vi.mock("@/app/chat/actions", () => ({ markAllChatUnreadReadAction: vi.fn() }));
vi.mock("@/components/chat/unread-threads-list", () => ({
  UnreadThreadsList: () => null,
  useUnreadThreadsQuery: () => undefined,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

// Against the real `SidebarMenuButton`, because the defect lived in its
// merge: tint classes on the child sat beside the primitive's grey hover
// fill, and the grey won on screen (PR #5119).
describe("All unreads row under the pointer", () => {
  it("keeps its tint on hover and press rather than the grey fill", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SidebarProvider>
          <ChatUnreadNavRows
            rooms={[]}
            currentUserId="user-1"
            dismissSheetOnNavigate={false}
            unreadOnly
            onUnreadOnlyChange={vi.fn()}
          />
        </SidebarProvider>
      </NextIntlClientProvider>,
    );

    const classes = screen
      .getByRole("button", { name: /^All unreads/ })
      .className.split(/\s+/);
    expect(classes).toContain("hover:bg-primary-quaternary");
    expect(classes).toContain("active:bg-primary-quaternary");
    expect(classes).not.toContain("hover:bg-sidebar-accent");
    expect(classes).not.toContain("active:bg-sidebar-accent");
  });
});
