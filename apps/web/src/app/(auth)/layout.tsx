import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { getSession } from "@/lib/auth/auth.server";
import { getDefaultAuthenticatedLandingPath } from "@/lib/utils/landing-path";

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

export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession({ refresh: true });

  if (session) {
    // Get pathname from middleware header
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") || "";

    // Skip redirect for OAuth and auth callback routes
    const shouldSkipRedirect =
      pathname.startsWith("/auth/callback/") || pathname.startsWith("/oauth");

    if (!shouldSkipRedirect) {
      const path = await getDefaultAuthenticatedLandingPath();
      redirect(path);
    }
  }

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
      <AuthBackground />
    </div>
  );
}

function AuthLayoutFooter() {
  const t = useTranslations("Auth.Footer");

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-center sm:gap-4">
      <Link
        href="https://www.sokosumi.com/terms-of-service"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm hover:text-gray-300"
      >
        {t("termsOfServices")}
      </Link>
      <Link
        href="https://www.sokosumi.com/privacy-policy"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm hover:text-gray-300"
      >
        {t("privacyPolicy")}
      </Link>
      <Link
        href="https://www.sokosumi.com/imprint"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm hover:text-gray-300"
      >
        {t("imprint")}
      </Link>
      <Link
        href="https://www.sokosumi.com/acceptable-use"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm hover:text-gray-300"
      >
        {t("acceptableUse")}
      </Link>
    </div>
  );
}
