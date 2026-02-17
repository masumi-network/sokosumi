import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EmergencyDialog } from "@/components/emergency-dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ConversationsProvider } from "@/contexts/conversations-context";
import QueryProvider from "@/contexts/query-provider";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { chatUIEnabled } from "@/lib/flags/chat";
import { taskManagerMenuEnabled } from "@/lib/flags/task-manager";
import { userService } from "@/lib/services";

import Header from "./components/header";
import { OnboardingDialog } from "./components/onboarding-dialog";
import Sidebar from "./components/sidebar";

const FORCE_ONBOARDING_FOR_TESTING = false;

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

  const [
    cookieStore,
    isTaskManagerMenuEnabled,
    pendingInvitationId,
    isChatUIEnabled,
  ] = await Promise.all([
    cookieStorePromise,
    taskManagerMenuEnabled(),
    userService.getFirstPendingInvitationId(),
    chatUIEnabled(),
  ]);
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  if (pendingInvitationId) {
    return redirect(`/accept-invitation/${pendingInvitationId}`);
  }

  const shouldShowOnboarding =
    FORCE_ONBOARDING_FOR_TESTING ||
    (await userService.showOnboarding(session));

  const content = (
    <SidebarProvider
      defaultOpen={defaultOpen}
      data-app-shell
      className="flex max-w-svw overflow-clip"
    >
      <Sidebar
        session={session}
        taskManagerMenuEnabled={isTaskManagerMenuEnabled}
        chatUIEnabled={isChatUIEnabled}
      />
      <div
        className="flex min-w-0 flex-1 flex-col overflow-clip"
        data-app-content
      >
        <Header session={session} className="h-16 p-4" />
        <main
          className="relative flex min-h-[calc(100svh-64px)] flex-1 flex-col overflow-hidden p-4 pt-20 md:pt-4"
          data-app-main
        >
          <EmergencyDialog />
          <div
            className="flex h-full flex-1 flex-col overflow-hidden"
            data-app-main-inner
          >
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );

  return (
    <QueryProvider>
      {isChatUIEnabled ? (
        <ConversationsProvider>{content}</ConversationsProvider>
      ) : (
        content
      )}
      {shouldShowOnboarding && <OnboardingDialog />}
    </QueryProvider>
  );
}
