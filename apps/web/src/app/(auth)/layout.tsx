import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { AUTH_SHELL_SAFE_AREA_PADDING_CLASS } from "@/app/components/app-shell-safe-area";
import { LegalLinks } from "@/components/legal-links";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { AUTH_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { isTelemetryBlockedPath } from "@/lib/analytics/telemetry-blocked-paths";
import { getSession } from "@/lib/auth/auth.server";
import {
  authProductName,
  buildSignedOAuthQueryFromSearchParams,
  type OAuthRequestBrand,
  oauthRequestBrand,
} from "@/lib/auth/auth.utils";
import { cn } from "@/lib/utils";

import AuthBackground from "./components/auth-background";
import { CmoWordmark } from "./components/cmo-wordmark";

// Instant Nav prerenders a Cache Components shell that Vercel serves for
// POST/RSC to /signin|/signup as 405 (Method Not Allowed). Auth entry must
// stay fully dynamic — same opt-out as admin must-block gates.
export const instant = false;

const CMO_ICON = "/images/logos/cmo-xyz-icon.svg";

/** The signed OAuth request the proxy saw on this page (`x-search-params`). */
async function readOAuthQuery(): Promise<string | undefined> {
  return buildSignedOAuthQueryFromSearchParams(
    new URLSearchParams((await headers()).get("x-search-params") ?? ""),
  );
}

function brandOf(
  oauthQuery: string | undefined,
): OAuthRequestBrand | undefined {
  return oauthQuery ? oauthRequestBrand(oauthQuery) : undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Metadata");
  const brand = brandOf(await readOAuthQuery());
  const product = authProductName(brand);

  return {
    title: {
      default: t("Title.default", { product }),
      template: t("Title.template", { product }),
    },
    description: t("description"),
    ...(brand === "cmo" ? { icons: { icon: CMO_ICON } } : {}),
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
  const oauthQuery = await readOAuthQuery();
  const carriesOAuthRequest = oauthQuery !== undefined;
  const brand = brandOf(oauthQuery);
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
      redirect("/");
    }
  }

  const logo =
    brand === "cmo" ? (
      <CmoWordmark />
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
          ) : isTelemetryBlockedPath(pathname) ? (
            <a href="/" className="inline-flex min-h-6 items-center">
              {logo}
            </a>
          ) : (
            <Link href="/" className="inline-flex min-h-6 items-center">
              {logo}
            </Link>
          )}
          <main className="mx-auto flex w-full max-w-md flex-1 items-center justify-center">
            {children}
          </main>
          <LegalLinks brand={brand} />
        </div>
        {/* Signing in for another product: Sokosumi's own pitch and customer
            logos would read as a detour, so the form stands alone. */}
        {carriesOAuthRequest ? null : <AuthBackground />}
      </div>
    </ClientMessageBoundary>
  );
}
