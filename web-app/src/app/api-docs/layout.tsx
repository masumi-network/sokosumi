import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import HeaderApiDocs from "@/app/components/header-api-docs";

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

export default async function ApiDocsLayout({ children }: AppLayoutProps) {
  return (
    <>
      <div className="flex w-full flex-col overflow-clip">
        <HeaderApiDocs session={null} />
        <main className="relative min-h-[calc(100svh-64px)] p-0 pt-[50px] md:pt-0">
          {children}
        </main>
      </div>
    </>
  );
}
