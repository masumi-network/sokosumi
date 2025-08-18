import "./globals.css";

import { GoogleTagManager } from "@next/third-parties/google";
import * as Sentry from "@sentry/nextjs";
import { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import PlausibleProvider from "next-plausible";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { GlobalModalsContextProvider } from "@/components/modals/global-modals-context";
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
  return {
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
  const isProduction = getEnvSecrets().NODE_ENV === "production";

  return (
    <html lang={locale} suppressHydrationWarning className={inter.className}>
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      <head>
        <PlausibleProvider
          domain={getEnvPublicConfig().NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
          trackFileDownloads={true}
          trackOutboundLinks={true}
          hash={true}
          pageviewProps={true}
          taggedEvents={true}
        />
      </head>
      <body className="bg-background min-h-svh max-w-dvw antialiased">
        <Script src="/js/plain.js" strategy="afterInteractive" />
        <Script
          src="https://web.cmp.usercentrics.eu/modules/autoblocker.js"
          strategy="beforeInteractive"
        />
        <Script
          id="usercentrics-cmp"
          src="https://web.cmp.usercentrics.eu/ui/loader.js"
          {...(!isProduction && { "data-draft": "true" })}
          data-settings-id={getEnvSecrets().USER_CENTRICS_DATA_SETTINGS_ID}
          async
          strategy="beforeInteractive"
        />
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
      </body>
    </html>
  );
}
