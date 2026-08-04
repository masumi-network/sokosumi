import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import QueryProvider from "@/contexts/query-provider";

import { AppShellLoadingFrame } from "./components/app-shell-loading-frame";
import { AuthSessionGuard } from "./components/auth-session-guard";
import AuthenticatedAppFrame from "./components/authenticated-app-frame";

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

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <QueryProvider>
      <AuthSessionGuard />
      <DynamicAblyProvider>
        <SidebarProvider
          defaultOpen
          data-app-shell
          className="flex max-w-svw overflow-clip"
        >
          <Suspense
            fallback={<AppShellLoadingFrame>{children}</AppShellLoadingFrame>}
          >
            <AuthenticatedAppFrame>{children}</AuthenticatedAppFrame>
          </Suspense>
        </SidebarProvider>
      </DynamicAblyProvider>
    </QueryProvider>
  );
}
