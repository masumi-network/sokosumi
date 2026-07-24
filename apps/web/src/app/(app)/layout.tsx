import gravatarUrl from "gravatar-url";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { Coworker } from "@/app/chat/utils/types";
import { HistorySearchDialogProvider } from "@/app/components/history-search-dialog-provider";
import { EmergencyDialog } from "@/components/emergency-dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AccountNoticeProvider } from "@/contexts/account-notice-provider";
import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import { AppChatRailProvider } from "@/contexts/app-chat-rail-context";
import { ConversationsProvider } from "@/contexts/conversations-context";
import { CoworkersProvider } from "@/contexts/coworkers-context";
import { NotificationProvider } from "@/contexts/notification-provider";
import QueryProvider from "@/contexts/query-provider";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import type { Notice } from "@/lib/clients/generated/core";
import { DEFAULT_AUTHENTICATED_LANDING_PATH } from "@/lib/utils/landing-path";

import AppChatRailShell from "./components/app-chat-rail-shell";
import AppShellChrome from "./components/app-shell-chrome";
import { AppSidebarFallback } from "./components/app-sidebar-fallback";
import { AuthSessionGuard } from "./components/auth-session-guard";
import Header from "./components/header";
import { LoginAccountNoticeToast } from "./components/login-account-notice-toast.client";
import { NoticeDialogProvider } from "./components/notice-dialog-context";
import { NotificationToastListener } from "./components/notification-toast-listener";
import { NotificationToaster } from "./components/notification-toaster.client";

/** Stable empties so client providers do not see a new [] reference each RSC pass. */
const EMPTY_COWORKERS: Coworker[] = [];
const EMPTY_NOTICES: Notice[] = [];

interface AppLayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Metadata");

  return {
    title: {
      default: t("Title.default"),
      template: t("Title.template"),
    },
    description: t("description"),
  };
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname");

  if (pathname === "/") {
    redirect(DEFAULT_AUTHENTICATED_LANDING_PATH);
  }

  const cookieStorePromise = cookies();
  const session = await getSessionOrRedirect();

  const cookieStore = await cookieStorePromise;
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const defaultChatRailOpen =
    cookieStore.get("chat_sidebar_state")?.value === "true";
  const userImageUrl =
    session.user.image ??
    gravatarUrl(session.user.email ?? "", {
      size: 80,
      default: "404",
    });

  return (
    <QueryProvider>
      <AuthSessionGuard />
      <ConversationsProvider>
        <DynamicAblyProvider>
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
                  <SidebarProvider
                    defaultOpen={defaultOpen}
                    data-app-shell
                    className="flex max-w-svw overflow-clip"
                  >
                    <HistorySearchDialogProvider
                      activeOrganizationId={
                        session.session.activeOrganizationId ?? null
                      }
                    >
                      <AppChatRailProvider defaultOpen={defaultChatRailOpen}>
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
                              className="relative flex max-h-[calc(100svh-64px)] min-h-[calc(100svh-64px)] flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 pt-20 md:pt-4"
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
                          <Suspense fallback={null}>
                            <AppChatRailShell
                              session={session}
                              userImageUrl={userImageUrl}
                            />
                          </Suspense>
                        </div>
                      </AppChatRailProvider>
                    </HistorySearchDialogProvider>
                  </SidebarProvider>
                </NoticeDialogProvider>
              </CoworkersProvider>
            </AccountNoticeProvider>
          </NotificationProvider>
        </DynamicAblyProvider>
      </ConversationsProvider>
    </QueryProvider>
  );
}
