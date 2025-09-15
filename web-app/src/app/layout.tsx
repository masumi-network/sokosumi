import "./globals.css";

import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import * as Sentry from "@sentry/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { GlobalModalsContextProvider } from "@/components/modals/global-modals-context";
import { ApplePwaHead } from "@/components/pwa/apple-pwa-head";
import { Toaster } from "@/components/ui/sonner";
import { UsersnapProvider } from "@/components/usersnap/usersnap-provider";
import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
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
  const locale = await getLocale();
  const messages = await getMessages();
  const gtmId = getEnvPublicConfig().NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID;
  const gaId = getEnvPublicConfig().NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;
  const ucDataSettingsId = getEnvSecrets().USER_CENTRICS_DATA_SETTINGS_ID;
  const isMainnet = getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Mainnet";

  return (
    <html lang={locale} suppressHydrationWarning className={inter.className}>
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      <head>
        <ApplePwaHead />
      </head>
      <body className="bg-background min-h-svh max-w-dvw antialiased">
        <Script src="/js/plain.js" strategy="afterInteractive" />
        {ucDataSettingsId && (
          <>
            <Script
              src="https://web.cmp.usercentrics.eu/modules/autoblocker.js"
              strategy="beforeInteractive"
            />
            <Script
              id="usercentrics-cmp"
              src="https://web.cmp.usercentrics.eu/ui/loader.js"
              {...(!isMainnet && { "data-draft": "true" })}
              data-settings-id={ucDataSettingsId}
              async
              strategy="beforeInteractive"
            />
            <Script src="/js/before-gtm.js" strategy="beforeInteractive" />
          </>
        )}
        <UsersnapProvider>
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
        </UsersnapProvider>
        <Analytics />
        <SpeedInsights />
      </body>
      {gaId && <GoogleAnalytics gaId={gaId} />}
    </html>
  );
}
