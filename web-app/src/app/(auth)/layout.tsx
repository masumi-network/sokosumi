import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import MainFooter from "@/components/main-footer";

import Header from "./components/header";
import Heroes from "./components/heroes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Metadata");

  return {
    title: {
      default: t("Title.default"),
      template: t("Title.template"),
    },
    description: t("description"),
  };
}

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-1 flex-col">
      <Header />
      <div className="container grid flex-1 grid-cols-1 justify-items-center gap-8 px-8 py-24 xl:grid-cols-2 xl:justify-items-start">
        <div className="hidden xl:block">
          <Heroes />
        </div>
        <div className="w-full max-w-xl rounded-lg border border-gray-200 p-3">
          <div className="flex flex-col">{children}</div>
        </div>
      </div>
      <MainFooter />
    </div>
  );
}
