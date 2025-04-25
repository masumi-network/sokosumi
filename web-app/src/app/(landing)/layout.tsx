import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Footer from "@/components/footer";

import Header from "./components/header";

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

export default function LandingLayout({ children }: LandingLayoutProps) {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <main className="flex-1 pt-24">{children}</main>
      <Footer />
    </div>
  );
}
