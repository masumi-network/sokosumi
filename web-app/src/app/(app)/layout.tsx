import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { FooterSections } from "@/components/footer";
import { SidebarProvider } from "@/components/ui/sidebar";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { userService } from "@/lib/services";

import Header from "./components/header";
import HydraHandoffDialog from "./components/hydra-handoff-dialog.client";
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

  if (shouldShowOnboarding) {
    redirect("/onboarding");
  }

  return (
    <>
      <SidebarProvider
        defaultOpen={defaultOpen}
        className="flex max-w-svw overflow-clip"
      >
        <Sidebar session={session} />
        <div className="flex min-w-0 flex-1 flex-col overflow-clip">
          <Header session={session} className="h-16 p-4" />
          <HydraHandoffDialog />
          <main className="relative min-h-[calc(100svh-64px)] p-4 pt-20 md:pt-4">
            {children}
          </main>
          <FooterSections className="p-4" />
        </div>
      </SidebarProvider>
    </>
  );
}
