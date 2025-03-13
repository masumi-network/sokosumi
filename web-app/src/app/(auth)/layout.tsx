import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import CloseButton from "./components/close-button";
import Header from "./components/header";

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
      <div className="flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex items-center justify-start">
          <CloseButton />
        </div>
        <div className="flex flex-1 items-center justify-center rounded-lg border border-gray-200 p-3">
          <div className="flex w-full flex-col">{children}</div>
        </div>
      </div>
    </div>
  );
}
