import "./globals.css";

import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import * as Sentry from "@sentry/nextjs";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { ClientAnalytics } from "@/components/analytics/client-analytics";
import { DeploymentRefreshHandler } from "@/components/deployment-refresh-handler";
import { GlobalModalsContextProvider } from "@/components/modals/global-modals-context";
import { ApplePwaHead } from "@/components/pwa/apple-pwa-head";
import { Toaster } from "@/components/ui/sonner";
import { getEnvPublicConfig } from "@/config/env.public";
import { ThemeProvider } from "@/contexts/theme-context";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  fallback: ["sans-serif"],
});

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const gtmId = getEnvPublicConfig().NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID;
  const gaId = getEnvPublicConfig().NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;

  return (
    <html lang={locale} suppressHydrationWarning className={inter.className}>
      <head>
        <ApplePwaHead />
      </head>
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      {gaId && <GoogleAnalytics gaId={gaId} />}
      <body className="bg-background min-h-svh max-w-dvw antialiased">
        <NuqsAdapter>
          <ThemeProvider>
            <NextIntlClientProvider messages={messages}>
              <GlobalModalsContextProvider>
                <div className="bg-background">{children}</div>
              </GlobalModalsContextProvider>
              {/* Toaster */}
              <Toaster />
            </NextIntlClientProvider>
          </ThemeProvider>
        </NuqsAdapter>
        <ClientAnalytics />
        <DeploymentRefreshHandler />
      </body>
    </html>
  );
}
