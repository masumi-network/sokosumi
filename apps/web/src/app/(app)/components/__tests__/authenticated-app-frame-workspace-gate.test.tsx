import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readRouteSessionMock = vi.fn();
const getWorkspaceAccessMock = vi.fn();
const hasAssignedOrganizationSeatMock = vi.fn();
const hasCurrentUserCalendarBetaAccessMock = vi.fn();
const privateCachedAppSidebarMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  signInRedirectPath: async () => "/signin?returnUrl=%2F",
}));

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: (...args: unknown[]) => readRouteSessionMock(...args),
}));

vi.mock("@sokosumi/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/utils")>()),
  hasAdminRole: () => false,
}));

vi.mock("@/lib/calendar-beta-access.server", () => ({
  hasCurrentUserCalendarBetaAccess: () =>
    hasCurrentUserCalendarBetaAccessMock(),
}));

vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: {
    hasAssignedSeat: (...args: unknown[]) =>
      hasAssignedOrganizationSeatMock(...args),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getWorkspaceAccess: (...args: unknown[]) => getWorkspaceAccessMock(...args),
  },
}));

vi.mock("@/app/chat/components/authenticated-channel-cache", () => ({
  AuthenticatedChannelCache: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Heavy chrome deps — not exercised by gate redirect tests.
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
vi.mock("@/contexts/breadcrumb-override-context", () => ({
  BreadcrumbOverrideProvider: ({ children }: { children: React.ReactNode }) => (
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
vi.mock("../private-cached-app-sidebar", () => ({
  default: (props: unknown) => {
    privateCachedAppSidebarMock(props);
    return null;
  },
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
vi.mock("@/components/emergency-dialog/emergency-dialog", () => ({
  EmergencyDialog: () => null,
}));

describe("AuthenticatedAppFrame workspace gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: {
        user: { id: "user-1", role: "user" },
        session: { id: "session-1", activeOrganizationId: null },
      },
    });
    hasAssignedOrganizationSeatMock.mockResolvedValue(true);
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(false);
  });

  it("redirects not-ready users to the workspace gate before chrome", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });

    const { default: AuthenticatedAppFrame } = await import(
      "../authenticated-app-frame"
    );

    await expect(
      AuthenticatedAppFrame({ children: <div>app</div> }),
    ).rejects.toThrow("REDIRECT:/setup");
    expect(redirectMock).toHaveBeenCalledWith("/setup");
  });

  it("redirects when workspace access is missing (fail closed)", async () => {
    getWorkspaceAccessMock.mockResolvedValue(null);

    const { default: AuthenticatedAppFrame } = await import(
      "../authenticated-app-frame"
    );

    await expect(
      AuthenticatedAppFrame({ children: <div>app</div> }),
    ).rejects.toThrow("REDIRECT:/setup");
  });

  it("allows ready users through to the app chrome", async () => {
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(true);
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "ready",
      hasPersonalWorkspace: true,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });

    const { default: AuthenticatedAppFrame } = await import(
      "../authenticated-app-frame"
    );

    const ui = await AuthenticatedAppFrame({ children: <div>app</div> });
    render(ui);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(ui).toBeTruthy();
    expect(privateCachedAppSidebarMock).toHaveBeenCalledWith(
      expect.objectContaining({ calendarMenuEnabled: true }),
    );
  });
});
