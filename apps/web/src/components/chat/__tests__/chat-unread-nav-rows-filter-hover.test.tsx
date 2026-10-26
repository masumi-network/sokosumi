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

// The filter is a mode, not a place: switched on, its tint holds under the
// pointer and the press instead of giving way to the grey hover fill
// (PR #5119).
describe("All unreads filter under the pointer", () => {
  it("keeps its tint on hover and press rather than the grey fill", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SidebarProvider>
          <ChatUnreadNavRows
            rooms={[]}
            dismissSheetOnNavigate={false}
            unreadOnly
            onUnreadOnlyChange={vi.fn()}
          />
        </SidebarProvider>
      </NextIntlClientProvider>,
    );

    const classes = screen
      .getByRole("button", { name: "Unreads" })
      .className.split(/\s+/);
    expect(classes).toContain("hover:bg-primary-quaternary");
    expect(classes).toContain("active:bg-primary-quaternary");
    expect(classes.filter((c) => c.startsWith("hover:bg-"))).toEqual([
      "hover:bg-primary-quaternary",
    ]);
  });
});
