import "./globals.css";

import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import * as Sentry from "@sentry/nextjs";
import { DEFAULT_LOCALE } from "@sokosumi/utils";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";

import { AnalyticsUserId } from "@/components/analytics/analytics-user-id";
import { ClientAnalytics } from "@/components/analytics/client-analytics";
import { ConsentModeInit } from "@/components/analytics/consent-mode-init";
import { CookieBanner } from "@/components/analytics/cookie-banner";
import { DeploymentRefreshHandler } from "@/components/deployment-refresh-handler";
import { DynamicTypeRootCap } from "@/components/dynamic-type-root-cap";
import { ApplePwaHead } from "@/components/pwa/apple-pwa-head";
import { getEnvPublicConfig } from "@/config/env.public";
import { ThemeProvider } from "@/contexts/theme-context";
import { APP_VIEWPORT_BASE } from "@/lib/app-viewport";

import { RootIntlTree } from "./components/root-intl-tree";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  fallback: ["sans-serif"],
  variable: "--font-inter",
});

/**
 * Root viewport. Safe-area padding for notched / PWA chrome lives in app
 * shells (`app-shell-safe-area.ts`). Scale lock + fit cover: `APP_VIEWPORT_BASE`.
 * Chat layout spreads the same base and adds `interactiveWidget`.
 */
export const viewport: Viewport = {
  ...APP_VIEWPORT_BASE,
};

export function generateMetadata(): Metadata {
  const isMainnet = getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Mainnet";

  return {
    ...(!isMainnet && {
      robots: {
        index: false,
        follow: false,
      },
    }),
    other: {
      ...Sentry.getTraceData(),
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gtmId = getEnvPublicConfig().NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID;
  const gaId = getEnvPublicConfig().NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;
  // Consent gates BOTH Google tags. Keying the banner off gtmId alone meant a
  // GA-only deploy loaded Analytics with no consent init and no way to refuse.
  const analyticsEnabled = Boolean(gtmId || gaId);

  return (
    <html
      lang={DEFAULT_LOCALE}
      suppressHydrationWarning
      className={`${inter.className} ${inter.variable}`}
    >
      <head>
        <ApplePwaHead />
      </head>
      {/* Consent Mode (denied by default) MUST be set before GTM loads. */}
      {analyticsEnabled && <ConsentModeInit />}
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      {gaId && <GoogleAnalytics gaId={gaId} />}
      <body className="bg-background min-h-svh max-w-dvw antialiased">
        <DynamicTypeRootCap />
        <NuqsAdapter>
          <ThemeProvider>
            <Suspense fallback={<div className="bg-background min-h-svh" />}>
              <RootIntlTree>
                {children}
                {analyticsEnabled && <CookieBanner />}
              </RootIntlTree>
            </Suspense>
          </ThemeProvider>
        </NuqsAdapter>
        <ClientAnalytics />
        {analyticsEnabled && <AnalyticsUserId />}
        <DeploymentRefreshHandler />
      </body>
    </html>
  );
}
