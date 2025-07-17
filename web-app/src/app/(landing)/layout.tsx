import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Footer from "@/components/footer";
import { UTMProvider } from "@/contexts/utm-provider";

import { Header } from "./components/header";

interface LandingLayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing.Metadata");

  return {
    title: {
      default: t("Title.default"),
      template: t("Title.template"),
    },
    description: t("description"),
  };
}

export default async function LandingLayout({ children }: LandingLayoutProps) {
  return (
    <UTMProvider>
      <div className="flex flex-col">
        <Header className="h-30" />
        <main className="min-h-[calc(100svh-120px)] flex-1 pt-30">
          {children}
        </main>
        <Footer />
      </div>
    </UTMProvider>
  );
}
