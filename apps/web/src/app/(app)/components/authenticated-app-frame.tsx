import { hasAdminRole } from "@sokosumi/utils";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthenticatedRoomCache } from "@/app/chat/components/authenticated-room-cache";
import { HistorySearchDialogProvider } from "@/app/components/history-search-dialog-provider";
import { EmergencyDialog } from "@/components/emergency-dialog/emergency-dialog";
import { ImpersonationBanner } from "@/components/impersonation/impersonation-banner";
import { AccountNoticeProvider } from "@/contexts/account-notice-provider";
import { BreadcrumbOverrideProvider } from "@/contexts/breadcrumb-override-context";
import { NotificationProvider } from "@/contexts/notification-provider";
import { OrgPresenceProvider } from "@/contexts/org-presence-provider";
import { OrganizationSeatContext } from "@/contexts/organization-seat-context";
import { signInRedirectPath } from "@/lib/auth/auth.server";
import { readRouteSession } from "@/lib/auth/route-session";
import type { Notice } from "@/lib/clients/generated/core";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import { userService } from "@/lib/services/user.service";
import { cn } from "@/lib/utils";
import { isWorkspaceReady, WORKSPACE_GATE_PATH } from "@/lib/workspace-gate";
import { AccountNoticeToast } from "./account-notice-toast.client";
import { AppMobileChrome } from "./app-mobile-chrome.client";
import AppShellOverlays from "./app-shell-overlays";
import {
  APP_MAIN_MOBILE_PT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS,
} from "./app-shell-safe-area";
import { AuthSessionHydrator } from "./auth-session-hydrator.client";
import { CoreUnavailableNotice } from "./core-unavailable-notice.client";
import Header from "./header";
import { NewTaskWizardProvider } from "./new-task-wizard-provider";
import { NoticeDialogProvider } from "./notice-dialog-context";
import { NotificationToaster } from "./notification-toaster.client";
import PrivateCachedAppSidebar from "./private-cached-app-sidebar";

const EMPTY_NOTICES: Notice[] = [];

interface AuthenticatedAppFrameProps {
  children: React.ReactNode;
}

export default async function AuthenticatedAppFrame({
  children,
}: AuthenticatedAppFrameProps) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return <CoreUnavailableNotice />;
  }
  if (sessionRead.status === "signedOut") {
    redirect(await signInRedirectPath());
  }
  const session = sessionRead.session;

  // Workspace gate is the only access decision for product chrome — not
  // `onboardingCompleted`. Fail closed: not-ready or workspace-access failure → gate
  // (gate page distinguishes identity vs temporary load failure for the user).
  let workspaceGate: string | null = null;
  try {
    const workspaceAccess = await userService.getWorkspaceAccess();
    workspaceGate = workspaceAccess?.gate ?? null;
  } catch (error) {
    console.error("Failed to load workspace access for app frame", error);
  }
  if (!isWorkspaceReady(workspaceGate)) {
    redirect(WORKSPACE_GATE_PATH);
  }

  const adminMenuEnabled = hasAdminRole(
    (session.user as typeof session.user & { role?: string | null }).role,
  );

  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const hasAssignedSeat = await organizationSeatService
    .hasAssignedSeat(activeOrganizationId)
    .catch((error) => {
      console.error("Failed to resolve assigned organization seat", error);
      return activeOrganizationId == null;
    });

  // AuthSessionHydrator must be an earlier sibling, not a wrapper.
  // Wrapping chrome would flush Header/Drive layout effects first.
  return (
    <>
      <AuthSessionHydrator session={session} />
      <OrganizationSeatContext value={hasAssignedSeat}>
        <NotificationProvider
          key={session.user.id}
          userId={session.user.id}
          sessionId={session.session.id}
          sessionCreatedAt={new Date(session.session.createdAt).getTime()}
        >
          <OrgPresenceProvider organizationId={activeOrganizationId}>
            <AccountNoticeProvider notice={null} sessionId={session.session.id}>
              <NoticeDialogProvider
                legalNotices={EMPTY_NOTICES}
                announcementNotices={EMPTY_NOTICES}
              >
                <NotificationToaster />
                <AccountNoticeToast />
                <HistorySearchDialogProvider
                  activeOrganizationId={activeOrganizationId}
                >
                  <BreadcrumbOverrideProvider>
                    {/* Sidebar "New Task" opens the wizard in place, so the
                        provider wraps sidebar and content. */}
                    <AuthenticatedRoomCache
                      currentUserId={session.user.id}
                      workspaceId={activeOrganizationId}
                    >
                      <NewTaskWizardProvider>
                        <PrivateCachedAppSidebar
                          sessionUser={session.user}
                          activeOrganizationId={activeOrganizationId}
                          adminMenuEnabled={adminMenuEnabled}
                        />
                        <Suspense fallback={null}>
                          <AppShellOverlays />
                        </Suspense>
                        <div
                          className="flex min-w-0 flex-1 overflow-clip"
                          data-app-content
                        >
                          <div
                            className="flex min-w-0 flex-1 flex-col overflow-clip"
                            data-app-content-inner
                          >
                            <ImpersonationBanner
                              name={session.user.name}
                              email={session.user.email}
                              impersonatedBy={
                                session.session.impersonatedBy ?? null
                              }
                            />
                            <Header
                              // Horizontal pad only on md: vertical py would fight the
                              // shared h-16 hairline with SidebarHeader.
                              className="px-4 py-3 md:px-4 md:py-0"
                              session={session}
                            />
                            <main
                              className={cn(
                                // p-4 is the app's single horizontal gutter. Pages must not add one
                                // of their own: a rule that spans the view escapes exactly this
                                // much, so a second level of padding leaves it short.
                                //
                                // scrollbar-gutter: stable reserves the scrollbar's width whether
                                // or not it is showing. Without it this scroll container takes that
                                // width out of the content box on the right only, and every
                                // full-bleed rule stops further from the right edge than the left.
                                "relative flex max-h-dvh min-h-dvh flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable] md:pt-4",
                                APP_MAIN_MOBILE_PT_CLASS,
                                APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS,
                                APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS,
                              )}
                              data-app-main
                            >
                              <EmergencyDialog />
                              <div
                                className="flex min-h-full flex-1 flex-col overflow-visible"
                                data-app-main-inner
                              >
                                <AppMobileChrome>{children}</AppMobileChrome>
                              </div>
                            </main>
                          </div>
                        </div>
                      </NewTaskWizardProvider>
                    </AuthenticatedRoomCache>
                  </BreadcrumbOverrideProvider>
                </HistorySearchDialogProvider>
              </NoticeDialogProvider>
            </AccountNoticeProvider>
          </OrgPresenceProvider>
        </NotificationProvider>
      </OrganizationSeatContext>
    </>
  );
}
