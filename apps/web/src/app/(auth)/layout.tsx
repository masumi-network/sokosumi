import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
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
import {
  buildSignedOAuthQueryFromSearchParams,
  oauthRequestBrand,
} from "@/lib/auth/auth.utils";
import { LEGAL_URLS } from "@/lib/constants/legal-urls";
import { cn } from "@/lib/utils";
import { DEFAULT_AUTHENTICATED_LANDING_PATH } from "@/lib/utils/landing-path";

import AuthBackground from "./components/auth-background";

// Instant Nav prerenders a Cache Components shell that Vercel serves for
// POST/RSC to /signin|/signup as 405 (Method Not Allowed). Auth entry must
// stay fully dynamic — same opt-out as admin must-block gates.
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
  // Pathname and query from proxy (`x-pathname`, `x-search-params`). OAuth
  // consent pages never redirect away on an existing session, and a page that
  // carries an OAuth request hands a signed-in person back to the provider
  // itself, so both skip the Core session read here. Password reset serves
  // signed-in people too: someone who signed in with a code because they
  // forgot the password still needs the emailed link to work.
  await connection();
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "";
  const oauthQuery = buildSignedOAuthQueryFromSearchParams(
    new URLSearchParams(headersList.get("x-search-params") ?? ""),
  );
  const carriesOAuthRequest = oauthQuery !== undefined;
  const brand = oauthQuery ? oauthRequestBrand(oauthQuery) : undefined;
  const shouldSkipSessionCheck =
    pathname.startsWith("/oauth") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    carriesOAuthRequest;

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

  const logo =
    brand === "cmo" ? (
      <CmoLogo />
    ) : (
      <ThemedLogo
        LogoComponent={SokosumiLogo}
        priority
        width={100}
        height={13}
      />
    );

  return (
    <ClientMessageBoundary paths={AUTH_MESSAGE_PATHS}>
      <div
        data-brand={brand}
        className={cn("flex h-dvh gap-6", AUTH_SHELL_SAFE_AREA_PADDING_CLASS)}
      >
        <div className="flex h-full flex-1 flex-col gap-6">
          {carriesOAuthRequest ? (
            // Leaving for Sokosumi's home would drop the OAuth request; the
            // header links back to the product instead.
            <div className="inline-flex min-h-6 items-center">{logo}</div>
          ) : (
            <Link href="/" className="inline-flex min-h-6 items-center">
              {logo}
            </Link>
          )}
          <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center">
            {children}
          </div>
          <AuthLayoutFooter usesSokosumi={brand === "cmo"} />
        </div>
        {/* Signing in for another product: Sokosumi's own pitch and customer
            logos would read as a detour, so the form stands alone. */}
        {carriesOAuthRequest ? null : <AuthBackground />}
      </div>
    </ClientMessageBoundary>
  );
}

/** CMO.xyz's mark, the mascot's head, beside its name. */
function CmoLogo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <Image
        src="/images/logos/cmo-logo.svg"
        alt=""
        width={17}
        height={24}
        priority
      />
      CMO.xyz
    </span>
  );
}

/**
 * The legal links. A product with its own look still signs people in with a
 * Sokosumi account, so its pages say so above them.
 */
function AuthLayoutFooter({ usesSokosumi }: { usesSokosumi: boolean }) {
  const t = useTranslations("Auth.Footer");

  return (
    <div className="flex flex-col items-center gap-2">
      {usesSokosumi ? (
        <p className="text-sm text-muted-foreground">{t("usesSokosumi")}</p>
      ) : null}
      <AuthLegalLinks />
    </div>
  );
}

function AuthLegalLinks() {
  const t = useTranslations("Auth.Footer");

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-center sm:gap-4">
      <Link
        href={LEGAL_URLS.TERMS_OF_SERVICE}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {t("termsOfServices")}
      </Link>
      <Link
        href={LEGAL_URLS.PRIVACY_POLICY}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {t("privacyPolicy")}
      </Link>
      <Link
        href={LEGAL_URLS.IMPRINT}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {t("imprint")}
      </Link>
      <Link
        href={LEGAL_URLS.ACCEPTABLE_USE}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {t("acceptableUse")}
      </Link>
    </div>
  );
}
