import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FooterSections } from "@/components/footer";
import QueryProvider from "@/contexts/query-provider";

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

export default async function ShareLayout({ children }: ShareLayoutProps) {
  return (
    <QueryProvider>
      <div className="flex w-full flex-col overflow-clip">
        <Header className="h-16 p-4" />
        <main className="relative min-h-[calc(100svh-64px)] pt-20 md:pt-4">
          {children}
        </main>
        <div className="container mx-auto flex justify-center p-4 md:p-8">
          <div className="w-full">
            <SharePageCTA />
          </div>
        </div>
        <FooterSections className="p-4" />
      </div>
    </QueryProvider>
  );
}
