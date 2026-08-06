import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { SHARE_MESSAGE_PATHS } from "@/i18n/message-namespaces";

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
        <Header className="h-16 p-4" />
        <main className="relative min-h-[calc(100svh-4rem)]">{children}</main>
        <div className="container mx-auto flex justify-center p-4 md:p-8">
          <div className="w-full">
            <SharePageCTA />
          </div>
        </div>
      </div>
    </ClientMessageBoundary>
  );
}
