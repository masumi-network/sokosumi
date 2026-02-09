import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { EmergencyDialog } from "@/components/emergency-dialog";
import { FooterSections } from "@/components/footer";
import { SidebarProvider } from "@/components/ui/sidebar";
import QueryProvider from "@/contexts/query-provider";
import type { Session } from "@/lib/auth/auth";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { taskManagerMenuEnabled } from "@/lib/flags/task-manager";
import { userService } from "@/lib/services";

import Header from "./components/header";
import Sidebar from "./components/sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

async function OnboardingRedirectGuard({ session }: { session: Session }) {
  const [pendingInvitationId, shouldShowOnboarding] = await Promise.all([
    userService.getFirstPendingInvitationId(),
    userService.showOnboarding(session),
  ]);

  if (pendingInvitationId) {
    return redirect(`/accept-invitation/${pendingInvitationId}`);
  }

  if (shouldShowOnboarding) {
    return redirect("/onboarding");
  }

  return null;
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

  const [cookieStore, isTaskManagerMenuEnabled] = await Promise.all([
    cookieStorePromise,
    taskManagerMenuEnabled(),
  ]);
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <QueryProvider>
      <Suspense fallback={null}>
        <OnboardingRedirectGuard session={session} />
      </Suspense>
      <SidebarProvider
        defaultOpen={defaultOpen}
        className="flex max-w-svw overflow-clip"
      >
        <Sidebar
          session={session}
          taskManagerMenuEnabled={isTaskManagerMenuEnabled}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-clip">
          <Header session={session} className="h-16 p-4" />
          <main className="relative min-h-[calc(100svh-64px)] p-4 pt-20 md:pt-4">
            <EmergencyDialog />
            {children}
          </main>
          <FooterSections className="p-4" />
        </div>
      </SidebarProvider>
    </QueryProvider>
  );
}
