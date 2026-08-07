import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS } from "@/app/components/app-shell-safe-area";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { SHARE_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { cn } from "@/lib/utils";

import Header from "./components/header";
import SharePageCTA from "./components/share-page-cta";

interface ShareLayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Share.Metadata");

  return {
    title: {
      default: t("Title.default"),
      template: t("Title.template"),
    },
    description: t("description"),
  };
}

export default function ShareLayout({ children }: ShareLayoutProps) {
  return (
    <ClientMessageBoundary paths={SHARE_MESSAGE_PATHS}>
      <div className="flex w-full flex-col overflow-clip">
        <Header className="p-4" />
        <main
          className={cn("relative", APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS)}
        >
          {children}
        </main>
        <div className="container mx-auto flex justify-center p-4 md:p-8">
          <div className="w-full">
            <SharePageCTA />
          </div>
        </div>
      </div>
    </ClientMessageBoundary>
  );
}
