import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

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
      <div className="container grid flex-1 grid-cols-1 gap-8 p-8 lg:grid-cols-2">
        <div className="hidden items-start justify-start lg:flex">
          <Heroes />
        </div>
        <div className="flex max-w-3xl items-start justify-start rounded-lg border border-gray-200 p-3">
          <div className="flex w-full flex-col">{children}</div>
        </div>
      </div>
    </div>
  );
}
