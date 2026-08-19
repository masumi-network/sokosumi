import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AUTH_SHELL_SAFE_AREA_PADDING_CLASS } from "@/app/components/app-shell-safe-area";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { AUTH_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { getSession } from "@/lib/auth/auth.server";
import { LEGAL_URLS } from "@/lib/constants/legal-urls";
import { cn } from "@/lib/utils";
import { DEFAULT_AUTHENTICATED_LANDING_PATH } from "@/lib/utils/landing-path";

import AuthBackground from "./components/auth-background";

// Instant Nav prerenders a Cache Components shell that Vercel serves for
// POST/RSC to /signin|/signup as 405 (Method Not Allowed). Auth entry must
// stay fully dynamic — same opt-out as admin / Hermes must-block gates.
export const instant = false;

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
  // Pathname from proxy (`x-pathname`). Callback/OAuth pages never redirect
  // away on an existing session, so skip the Core session read entirely.
  await connection();
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "";
  const shouldSkipSessionCheck =
    pathname.startsWith("/auth/callback/") || pathname.startsWith("/oauth");

  if (!shouldSkipSessionCheck) {
    // Cookie-cache session is enough for "already signed in → leave auth UI".
    // `refresh: true` forced a Core DB hit on every signin/signup visit and
    // dominated TTFB for anonymous users (now also short-circuited in
    // getSession when no session cookie is present).
    const session = await getSession();
    if (session) {
      redirect(DEFAULT_AUTHENTICATED_LANDING_PATH);
    }
  }

  return (
    <ClientMessageBoundary paths={AUTH_MESSAGE_PATHS}>
      <div
        className={cn("flex h-svh gap-6", AUTH_SHELL_SAFE_AREA_PADDING_CLASS)}
      >
        <div className="flex h-full flex-1 flex-col gap-6">
          <Link href="/">
            <ThemedLogo
              LogoComponent={SokosumiLogo}
              priority
              width={100}
              height={13}
            />
          </Link>
          <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center">
            {children}
          </div>
          <AuthLayoutFooter />
        </div>
        <AuthBackground />
      </div>
    </ClientMessageBoundary>
  );
}

function AuthLayoutFooter() {
  const t = useTranslations("Auth.Footer");

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-center sm:gap-4">
      <Link
        href={LEGAL_URLS.TERMS_OF_SERVICE}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm hover:text-gray-300"
      >
        {t("termsOfServices")}
      </Link>
      <Link
        href={LEGAL_URLS.PRIVACY_POLICY}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm hover:text-gray-300"
      >
        {t("privacyPolicy")}
      </Link>
      <Link
        href={LEGAL_URLS.IMPRINT}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm hover:text-gray-300"
      >
        {t("imprint")}
      </Link>
      <Link
        href={LEGAL_URLS.ACCEPTABLE_USE}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm hover:text-gray-300"
      >
        {t("acceptableUse")}
      </Link>
    </div>
  );
}
