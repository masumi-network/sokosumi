import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import MainFooter from "@/components/main-footer";

import BreadcrumbNav from "./components/breadcrumb-nav";
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
      <BreadcrumbNav />
      <main className="flex-1">{children}</main>
      <MainFooter />
    </div>
  );
}
