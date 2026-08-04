import { Suspense } from "react";
import type { Coworker } from "@/app/chat/utils/types";
import { HistorySearchDialogProvider } from "@/app/components/history-search-dialog-provider";
import { EmergencyDialog } from "@/components/emergency-dialog";
import { AccountNoticeProvider } from "@/contexts/account-notice-provider";
import { BreadcrumbOverrideProvider } from "@/contexts/breadcrumb-override-context";
import { CoworkersProvider } from "@/contexts/coworkers-context";
import { NotificationProvider } from "@/contexts/notification-provider";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import type { Notice } from "@/lib/clients/generated/core";

import AppShellChrome from "./app-shell-chrome";
import { AppSidebarFallback } from "./app-sidebar-fallback";
import Header from "./header";
import { LoginAccountNoticeToast } from "./login-account-notice-toast.client";
import { NoticeDialogProvider } from "./notice-dialog-context";
import { NotificationToastListener } from "./notification-toast-listener";
import { NotificationToaster } from "./notification-toaster.client";

const EMPTY_COWORKERS: Coworker[] = [];
const EMPTY_NOTICES: Notice[] = [];

interface AuthenticatedAppFrameProps {
  children: React.ReactNode;
}

export default async function AuthenticatedAppFrame({
  children,
}: AuthenticatedAppFrameProps) {
  const session = await getSessionOrRedirect();

  return (
    <NotificationProvider userId={session.user.id}>
      <AccountNoticeProvider notice={null} sessionId={session.session.id}>
        <CoworkersProvider initialCoworkers={EMPTY_COWORKERS}>
          <NoticeDialogProvider
            legalNotices={EMPTY_NOTICES}
            announcementNotices={EMPTY_NOTICES}
          >
            <NotificationToaster />
            <NotificationToastListener userId={session.user.id} />
            <LoginAccountNoticeToast />
            <HistorySearchDialogProvider
              activeOrganizationId={
                session.session.activeOrganizationId ?? null
              }
            >
              <BreadcrumbOverrideProvider>
                <Suspense fallback={<AppSidebarFallback />}>
                  <AppShellChrome session={session} />
                </Suspense>
                <div
                  className="flex min-w-0 flex-1 overflow-clip"
                  data-app-content
                >
                  <div
                    className="flex min-w-0 flex-1 flex-col overflow-clip"
                    data-app-content-inner
                  >
                    <Header className="h-16 p-4" session={session} />
                    <main
                      className="relative flex max-h-svh min-h-svh flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 pt-20 md:max-h-[calc(100svh-64px)] md:min-h-[calc(100svh-64px)] md:pt-4"
                      data-app-main
                    >
                      <EmergencyDialog />
                      <div
                        className="flex h-full flex-1 flex-col overflow-visible"
                        data-app-main-inner
                      >
                        {children}
                      </div>
                    </main>
                  </div>
                </div>
              </BreadcrumbOverrideProvider>
            </HistorySearchDialogProvider>
          </NoticeDialogProvider>
        </CoworkersProvider>
      </AccountNoticeProvider>
    </NotificationProvider>
  );
}
