import { NoticeKind } from "@sokosumi/database";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EmergencyDialog } from "@/components/emergency-dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ChatSecondarySidebarProvider } from "@/contexts/chat-secondary-sidebar-context";
import { ConversationsProvider } from "@/contexts/conversations-context";
import { CoworkersProvider } from "@/contexts/coworkers-context";
import QueryProvider from "@/contexts/query-provider";
import { getPendingNoticesAction } from "@/lib/actions/notice";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { userService } from "@/lib/services";

import Header from "./components/header";
import { NoticeDialogProvider } from "./components/notice-dialog-context";
import { OnboardingDialog } from "./components/onboarding-dialog";
import Sidebar from "./components/sidebar";

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
  const cookieStorePromise = cookies();
  const session = await getSessionOrRedirect();

  const [cookieStore, pendingInvitationId] = await Promise.all([
    cookieStorePromise,
    userService.getFirstPendingInvitationId(),
  ]);
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  if (pendingInvitationId) {
    return redirect(`/accept-invitation/${pendingInvitationId}`);
  }

  const [shouldShowOnboarding, pendingNoticesResult] = await Promise.all([
    userService.showOnboarding(session),
    getPendingNoticesAction(),
  ]);
  const pendingNotices = pendingNoticesResult.ok
    ? pendingNoticesResult.data
    : [];
  const legalNotices = pendingNotices.filter(
    (notice) => notice.kind === NoticeKind.LEGAL_TERMS,
  );
  const announcementNotices = pendingNotices.filter(
    (notice) => notice.kind === NoticeKind.ANNOUNCEMENT,
  );

  const content = (
    <NoticeDialogProvider
      legalNotices={legalNotices}
      announcementNotices={announcementNotices}
    >
      <ChatSecondarySidebarProvider>
        <SidebarProvider
          defaultOpen={defaultOpen}
          data-app-shell
          className="flex max-w-svw overflow-clip"
        >
          <Sidebar session={session} />
          <div
            className="flex min-w-0 flex-1 flex-col overflow-clip"
            data-app-content
          >
            <Header session={session} className="h-16 p-4" />
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
        </SidebarProvider>
      </ChatSecondarySidebarProvider>
    </NoticeDialogProvider>
  );

  return (
    <QueryProvider>
      <ConversationsProvider>
        <CoworkersProvider>
          {content}
          {shouldShowOnboarding && <OnboardingDialog />}
        </CoworkersProvider>
      </ConversationsProvider>
    </QueryProvider>
  );
}
