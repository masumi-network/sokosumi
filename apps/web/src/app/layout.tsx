import "./globals.css";

import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import * as Sentry from "@sentry/nextjs";
import { DEFAULT_LOCALE } from "@sokosumi/utils";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";

import { ClientAnalytics } from "@/components/analytics/client-analytics";
import { DeploymentRefreshHandler } from "@/components/deployment-refresh-handler";
import { DynamicTypeRootCap } from "@/components/dynamic-type-root-cap";
import { ApplePwaHead } from "@/components/pwa/apple-pwa-head";
import { getEnvPublicConfig } from "@/config/env.public";
import { ThemeProvider } from "@/contexts/theme-context";

import { RootIntlTree } from "./components/root-intl-tree";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  fallback: ["sans-serif"],
  variable: "--font-inter",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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

  return (
    <html
      lang={DEFAULT_LOCALE}
      suppressHydrationWarning
      className={`${inter.className} ${inter.variable}`}
    >
      <head>
        <ApplePwaHead />
      </head>
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      {gaId && <GoogleAnalytics gaId={gaId} />}
      <body className="bg-background min-h-svh max-w-dvw antialiased">
        <DynamicTypeRootCap />
        <NuqsAdapter>
          <ThemeProvider>
            <Suspense fallback={<div className="bg-background min-h-svh" />}>
              <RootIntlTree>{children}</RootIntlTree>
            </Suspense>
          </ThemeProvider>
        </NuqsAdapter>
        <ClientAnalytics />
        <DeploymentRefreshHandler />
      </body>
    </html>
  );
}
