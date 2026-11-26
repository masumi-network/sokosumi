import type { ChatRoom } from "@sokosumi/core-client";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, readRouteSessionMock, getWorkspaceAccessMock } = vi.hoisted(
  () => ({
    fetchMock: vi.fn(),
    readRouteSessionMock: vi.fn(),
    getWorkspaceAccessMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  signInRedirectPath: async () => "/signin",
  getRequestPath: async () => "/",
}));
vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: (...args: unknown[]) => readRouteSessionMock(...args),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    },
  }),
}));
vi.mock("@/lib/ably/ably-connection-health-store", () => ({
  useAblyConnectionHealthy: () => true,
}));
vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: fetchMock,
}));
vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: { hasAssignedSeat: async () => true },
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getWorkspaceAccess: () => getWorkspaceAccessMock(),
    getMyWorkspaces: async () => ({
      workspaces: [],
      pendingInvitationCount: 0,
    }),
  },
}));
vi.mock("@/lib/clients/core.client", () => ({
  coreClient: { getMyBadgeCampaigns: async () => [] },
}));
vi.mock("@/lib/newsletter-access.server", () => ({
  isNewsletterEnabled: async () => false,
}));
vi.mock("@/app/chat/components/authenticated-room-cache", () => ({
  AuthenticatedRoomCache: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../sidebar/components/feature-badges", () => ({
  FeatureBadgesProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/contexts/notification-provider", () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/contexts/org-presence-provider", () => ({
  OrgPresenceProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/contexts/account-notice-provider", () => ({
  AccountNoticeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/contexts/organization-seat-context", () => ({
  OrganizationSeatContext: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/app/components/history-search-dialog-provider", () => ({
  HistorySearchDialogProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
}));
vi.mock(
  "@/app/components/workspace-switcher/workspace-switcher.client",
  () => ({
    WorkspaceSwitcherProvider: ({
      children,
    }: {
      children: React.ReactNode;
    }) => <>{children}</>,
  }),
);
vi.mock(
  "@/app/components/sidebar/components/sidebar-edge-handle.client",
  () => ({
    SidebarEdgeHandle: () => null,
  }),
);
vi.mock("../private-cached-app-sidebar", () => ({
  default: () => null,
}));
vi.mock("../header", () => ({
  default: () => null,
}));
vi.mock("../app-shell-overlays", () => ({
  default: () => null,
}));
vi.mock("../app-mobile-chrome.client", () => ({
  AppMobileChrome: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../account-notice-toast.client", () => ({
  AccountNoticeToast: () => null,
}));
vi.mock("../notice-dialog-context", () => ({
  NoticeDialogProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../notification-toaster.client", () => ({
  NotificationToaster: () => null,
}));
vi.mock("../auth-session-hydrator.client", () => ({
  AuthSessionHydrator: () => null,
}));
vi.mock("../core-unavailable-notice.client", () => ({
  CoreUnavailableNotice: () => (
    <div data-testid="core-unavailable-notice">unavailable</div>
  ),
}));
vi.mock("@/components/emergency-dialog/emergency-dialog", () => ({
  EmergencyDialog: () => null,
}));
vi.mock("@/components/warm-likely-pages.client", () => ({
  WarmLikelyPages: () => null,
}));
vi.mock("@/components/impersonation/impersonation-banner", () => ({
  ImpersonationBanner: () => null,
}));

import { clearMembershipVisibleRoomsSnapshot } from "@/components/chat/membership-visible-rooms-store";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import AuthenticatedAppFrame from "../authenticated-app-frame";

describe("AuthenticatedAppFrame live chat rooms reader placement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.stubGlobal("innerWidth", 390);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      rooms: [{ id: "room-1", name: "general", kind: "channel" } as ChatRoom],
    });
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts zero live-rooms readers on the CoreUnavailableNotice branch, including after an active invalidation", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "unavailable" });

    const view = render(await AuthenticatedAppFrame({ children: <div /> }));
    expect(screen.getByTestId("core-unavailable-notice")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      notifyOrganizationChatRoomsChanged({
        collections: ["active"],
        roomId: "room-1",
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    view.unmount();
  });

  it("mounts one LiveChatRoomsProvider on the authenticated chrome branch", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: {
        user: { id: "user-1", role: "user", name: "Alice", email: "a@test" },
        session: {
          id: "session-1",
          activeOrganizationId: "org-1",
          createdAt: new Date("2026-11-24T00:00:00Z"),
        },
      },
    });
    getWorkspaceAccessMock.mockResolvedValue({ gate: "ready" });

    const seen: (ChatRoom[] | null)[] = [];
    function Caller() {
      seen.push(useLiveChatRooms());
      return null;
    }

    const view = render(
      await AuthenticatedAppFrame({
        children: (
          <>
            <Caller />
            <Caller />
          </>
        ),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)?.map((r) => r.id)).toEqual(["room-1"]);

    view.unmount();
  });
});

vi.mock("@/app/components/sidebar/components/global-rail.client", () => ({
  GlobalRail: () => null,
}));

vi.mock(
  "@/app/components/workspace-switcher/workspace-switcher-menu.client",
  () => ({ default: () => null }),
);

vi.mock(
  "@/app/components/sidebar/components/sidebar-search-button.client",
  () => ({
    SidebarSearchButton: () => null,
  }),
);
vi.mock(
  "@/app/components/sidebar/components/sidebar-new-task-button.client",
  () => ({
    SidebarNewTaskButton: () => null,
  }),
);
