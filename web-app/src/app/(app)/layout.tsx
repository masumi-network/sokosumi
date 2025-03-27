import { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { BreadcrumbNavigation } from "@/components/breadcrumb-navigation";
import { SidebarProvider } from "@/components/ui/sidebar";

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
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar />
      <div className="flex h-svh flex-1 flex-col">
        <Header className="h-[64px]" />
        <main className="flex h-[calc(100svh-64px)] flex-1 flex-col">
          <div className="px-4 py-4 sm:px-8">
            <BreadcrumbNavigation />
          </div>
          <div className="flex flex-1 flex-col">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
