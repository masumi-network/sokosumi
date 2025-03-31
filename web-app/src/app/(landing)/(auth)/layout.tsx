import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Heroes from "./components/heroes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing.Auth.Metadata");

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
    <div className="container grid flex-1 grid-cols-1 justify-items-center gap-6 px-6 py-12 md:py-24 lg:grid-cols-2 lg:justify-items-start">
      <div className="hidden lg:block">
        <Heroes />
      </div>
      <div className="w-full max-w-xl">
        <div className="flex flex-col rounded-lg border border-gray-200 p-3">
          {children}
        </div>
      </div>
    </div>
  );
}
