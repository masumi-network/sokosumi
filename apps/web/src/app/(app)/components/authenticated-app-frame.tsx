import type { Notice } from "@sokosumi/core-client";
import { NoticeKind } from "@sokosumi/core-client";
import { hasAdminRole, type SessionUser } from "@sokosumi/utils";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthenticatedRoomCache } from "@/app/chat/components/authenticated-room-cache";
import {
  type AccountNotice,
  resolveAccountNotice,
} from "@/app/components/account-notice-state";
import { HistorySearchDialogProvider } from "@/app/components/history-search-dialog-provider";
import { mapAccountCreditsChrome } from "@/app/components/sidebar";
import { SidebarEdgeHandle } from "@/app/components/sidebar/components/sidebar-edge-handle.client";
import { WorkspaceSwitcherProvider } from "@/app/components/workspace-switcher/workspace-switcher.client";
import { EmergencyDialog } from "@/components/emergency-dialog/emergency-dialog";
import { ImpersonationBanner } from "@/components/impersonation/impersonation-banner";
import { WarmLikelyPages } from "@/components/warm-likely-pages.client";
import { getEnvPublicConfig } from "@/config/env.public";
import { AccountNoticeProvider } from "@/contexts/account-notice-provider";
import { NotificationProvider } from "@/contexts/notification-provider";
import { OrgPresenceProvider } from "@/contexts/org-presence-provider";
import { OrganizationSeatContext } from "@/contexts/organization-seat-context";
import { SocialProviderAvailabilityProvider } from "@/contexts/social-provider-availability-context";
import { getPendingNoticesAction } from "@/lib/actions/notice/action";
import { getRequestPath, signInRedirectPath } from "@/lib/auth/auth.server";
import { readRouteSession } from "@/lib/auth/route-session";
import { coreClient } from "@/lib/clients/core.client";
import { isNewsletterEnabled } from "@/lib/newsletter-access.server";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import { userService } from "@/lib/services/user.service";
import { cn } from "@/lib/utils";
import { isWorkspaceReady, workspaceGatePath } from "@/lib/workspace-gate";
import { AccountNoticeToast } from "./account-notice-toast.client";
import { AppMobileChrome } from "./app-mobile-chrome.client";
import {
  APP_MAIN_MOBILE_PT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS,
} from "./app-shell-safe-area";
import { AuthSessionHydrator } from "./auth-session-hydrator.client";
import { CoreUnavailableNotice } from "./core-unavailable-notice.client";
import Header from "./header";
import { NewTaskWizardProvider } from "./new-task-wizard-provider";
import {
  NoticeDialogProvider,
  type PendingNoticeGroups,
} from "./notice-dialog-context";
import { NotificationToaster } from "./notification-toaster.client";
import PrivateCachedAppSidebar from "./private-cached-app-sidebar";
import { getCachedMyCredits } from "./private-sidebar-cache";
import {
  type BadgeCampaignSummary,
  FeatureBadgesProvider,
} from "./sidebar/components/feature-badges";

const EMPTY_NOTICES: Notice[] = [];

/** Never rejects: a Core failure costs the sidebar its New badges, not its nav. */
function loadBadgeCampaigns(): Promise<BadgeCampaignSummary[]> {
  return coreClient.getMyBadgeCampaigns().catch((error: unknown) => {
    console.error("Failed to load badge campaigns for the sidebar", error);
    return [];
  });
}

/** Never rejects: shares the request-scoped credits read with SidebarDeferredAccount. */
function loadAccountNotice(
  sessionUser: SessionUser,
): Promise<AccountNotice | null> {
  const lowCreditsThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;
  return getCachedMyCredits()
    .then((creditsResult) => {
      const credits = mapAccountCreditsChrome(creditsResult);
      return resolveAccountNotice({
        credits: credits.totalCredits,
        currentPlan: credits.creditScope === null ? null : credits.currentPlan,
        email: sessionUser.email,
        emailVerified: sessionUser.emailVerified,
        threshold: lowCreditsThreshold,
      });
    })
    .catch(() => null);
}

/** Never rejects: pending notices stream in without blocking app chrome. */
function loadPendingNotices(): Promise<PendingNoticeGroups> {
  return getPendingNoticesAction()
    .then((result) => {
      const pendingNotices = result.ok ? result.value : [];
      return {
        legalNotices: pendingNotices.filter(
          (notice: Notice) => notice.kind === NoticeKind.LEGAL_TERMS,
        ),
        announcementNotices: pendingNotices.filter(
          (notice: Notice) => notice.kind === NoticeKind.ANNOUNCEMENT,
        ),
      };
    })
    .catch(() => ({
      legalNotices: EMPTY_NOTICES,
      announcementNotices: EMPTY_NOTICES,
    }));
}

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
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  // Neither read needs the workspace gate's answer, so both start beside it.
  // The seat gate is a single read the frame already has to finish before it
  // paints nav. Newsletter's workspace availability resolves alongside it.
  const hasAssignedSeatRead = organizationSeatService
    .hasAssignedSeat(activeOrganizationId)
    .catch((error) => {
      console.error("Failed to resolve assigned organization seat", error);
      return activeOrganizationId == null;
    });
  const newsletterEnabledRead = isNewsletterEnabled();

  // Workspace gate is the only access decision for product chrome — not
  // `onboardingCompleted`. Fail closed: not-ready or a failed workspaces read → gate
  // (gate page distinguishes identity vs temporary load failure for the user).
  let workspaceGate: string | null = null;
  try {
    const workspaceAccess = await userService.getWorkspaceAccess();
    workspaceGate = workspaceAccess?.gate ?? null;
  } catch (error) {
    console.error("Failed to load workspace access for app frame", error);
  }
  if (!isWorkspaceReady(workspaceGate)) {
    redirect(workspaceGatePath(await getRequestPath()));
  }

  const adminMenuEnabled = hasAdminRole(
    (session.user as typeof session.user & { role?: string | null }).role,
  );

  // One Core read (ADR 0051, cached per request): the Workspace switcher's
  // list and the active workspace's social providers.
  const workspaces = (await userService.getMyWorkspaces())?.workspaces ?? [];
  const enabledSocialProviders =
    workspaces.find(
      (workspace) => workspace.organizationId === activeOrganizationId,
    )?.enabledSocialProviders ?? [];
  const [hasAssignedSeat, newsletterEnabled] = await Promise.all([
    hasAssignedSeatRead,
    newsletterEnabledRead,
  ]);

  // AuthSessionHydrator must be an earlier sibling, not a wrapper.
  // Wrapping chrome would flush Header/Drive layout effects first.
  return (
    <>
      <AuthSessionHydrator session={session} />
      <OrganizationSeatContext value={hasAssignedSeat}>
        <NotificationProvider
          key={session.user.id}
          userId={session.user.id}
          organizationId={activeOrganizationId}
          sessionId={session.session.id}
          sessionCreatedAt={new Date(session.session.createdAt).getTime()}
        >
          <OrgPresenceProvider organizationId={activeOrganizationId}>
            <AccountNoticeProvider
              notice={null}
              noticePromise={loadAccountNotice(session.user)}
              sessionId={session.session.id}
            >
              <NoticeDialogProvider
                legalNotices={EMPTY_NOTICES}
                announcementNotices={EMPTY_NOTICES}
                pendingNoticesPromise={loadPendingNotices()}
              >
                <NotificationToaster />
                <AccountNoticeToast />
                {/* Sidebar "New Task" opens the wizard in place, so the
                  provider wraps sidebar and content; Search's "Mention in
                  a new Task" opens it too, so it wraps Search as well. */}
                <NewTaskWizardProvider>
                  <HistorySearchDialogProvider
                    activeOrganizationId={activeOrganizationId}
                  >
                    <AuthenticatedRoomCache
                      currentUserId={session.user.id}
                      workspaceId={activeOrganizationId}
                    >
                      {/* The sidebar header and the phone's top bar each
                          place a switcher trigger; this owns what is behind
                          them, once. */}
                      <WorkspaceSwitcherProvider
                        sessionUser={session.user}
                        workspaces={workspaces}
                        activeOrganizationId={activeOrganizationId}
                      >
                        <FeatureBadgesProvider
                          userId={session.user.id}
                          campaigns={loadBadgeCampaigns()}
                        >
                          <PrivateCachedAppSidebar
                            sessionUser={session.user}
                            activeOrganizationId={activeOrganizationId}
                            adminMenuEnabled={adminMenuEnabled}
                            newsletterEnabled={newsletterEnabled}
                          />
                        </FeatureBadgesProvider>
                        {/* Right after the sidebar: it follows the sidebar's
                          `data-state` as its peer. */}
                        <SidebarEdgeHandle />
                        {/* Reads the project scope from the URL's search
                            params, which wait for the request. */}
                        <Suspense fallback={null}>
                          <WarmLikelyPages />
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
                                "app-scrollbar relative flex max-h-dvh min-h-dvh flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable] md:pt-4",
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
                                <SocialProviderAvailabilityProvider
                                  enabledProviders={enabledSocialProviders}
                                >
                                  <AppMobileChrome>{children}</AppMobileChrome>
                                </SocialProviderAvailabilityProvider>
                              </div>
                            </main>
                          </div>
                        </div>
                      </WorkspaceSwitcherProvider>
                    </AuthenticatedRoomCache>
                  </HistorySearchDialogProvider>
                </NewTaskWizardProvider>
              </NoticeDialogProvider>
            </AccountNoticeProvider>
          </OrgPresenceProvider>
        </NotificationProvider>
      </OrganizationSeatContext>
    </>
  );
}
