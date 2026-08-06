import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/notifications",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

vi.mock("@/app/components/history-search-dialog-provider", () => ({
  useOptionalHistorySearch: () => ({
    openHistorySearch: vi.fn(),
    searchShortcutLabel: "Ctrl+K",
  }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import { AppShellLoadingFrame } from "@/app/components/app-shell-loading-frame";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";

/**
 * Instant Nav keeps `(app)` layout sync and streams AuthenticatedAppFrame
 * under Suspense. The fallback deliberately re-renders page `{children}`
 * (see layout.tsx) so the page can paint while session chrome streams.
 *
 * Those children still call framed providers (SOKOSUMI-QJ: notifications
 * page → useAccountNotice / useNotifications). The loading frame must
 * supply the same contexts — without REST/Ably side effects.
 *
 * SidebarProvider mirrors `(app)/layout.tsx` (outside Suspense); this test
 * isolates the loading-frame provider hole.
 */
function InstantNavPageProbe() {
  const { notice } = useAccountNotice();
  const { unreadCount, isLoading } = useNotifications();

  return (
    <div data-testid="instant-nav-page-probe">
      {notice === null ? "notice-null" : "notice-set"}:{unreadCount}:
      {String(isLoading)}
    </div>
  );
}

describe("AppShellLoadingFrame Instant Nav page children", () => {
  it("provides AccountNotice and Notification contexts so page children do not throw", () => {
    render(
      <SidebarProvider defaultOpen>
        <AppShellLoadingFrame>
          <InstantNavPageProbe />
        </AppShellLoadingFrame>
      </SidebarProvider>,
    );

    expect(screen.getByTestId("instant-nav-page-probe")).toHaveTextContent(
      "notice-null:0:true",
    );
  });
});
