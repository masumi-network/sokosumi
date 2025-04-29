import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";

import AuthBackground from "./components/auth-background";

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
    <div className="flex h-svh gap-6 p-6">
      <div className="flex h-full flex-1 flex-col gap-6">
        <Link href="/">
          <ThemedLogo LogoComponent={SokosumiLogo} priority />
        </Link>
        <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center">
          {children}
        </div>
        <AuthLayoutFooter />
      </div>
      <div className="hidden h-full w-1/2 lg:block">
        <AuthBackground />
      </div>
    </div>
  );
}

function AuthLayoutFooter() {
  const t = useTranslations("Auth.Footer");

  return (
    <div className="flex items-center justify-center gap-4">
      <Link href="/privacy-policy" className="text-sm hover:text-gray-300">
        {t("privacyPolicy")}
      </Link>
      <Link href="/terms-of-services" className="text-sm hover:text-gray-300">
        {t("termsOfServices")}
      </Link>
    </div>
  );
}
