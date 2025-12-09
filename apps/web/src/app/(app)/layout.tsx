import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EmergencyDialog } from "@/components/emergency-dialog";
import { FooterSections } from "@/components/footer";
import { SidebarProvider } from "@/components/ui/sidebar";
import QueryProvider from "@/contexts/query-provider";
import { authClient } from "@/lib/auth/auth.client";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { userService } from "@/lib/services";

import Header from "./components/header";
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
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  const session = await getSessionOrRedirect();
  const shouldShowOnboarding = await userService.showOnboarding(session);

  const { data: invitations } =
    await authClient.organization.listUserInvitations({
      fetchOptions: {
        headers: await headers(),
      },
    });
  // Check for pending, non-expired invitations
  if (invitations && invitations.length > 0) {
    const now = new Date();
    const pendingInvitation = invitations.find(
      (invitation) =>
        invitation.status === "pending" && new Date(invitation.expiresAt) > now,
    );

    if (pendingInvitation) {
      return redirect(`/accept-invitation/${pendingInvitation.id}`);
    }
  }

  if (shouldShowOnboarding) {
    return redirect("/onboarding");
  }

  return (
    <QueryProvider>
      <SidebarProvider
        defaultOpen={defaultOpen}
        className="flex max-w-svw overflow-clip"
      >
        <Sidebar session={session} />
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
