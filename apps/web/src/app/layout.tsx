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
  const draftUserCentrics = getEnvSecrets().DRAFT_USER_CENTRICS;
  const usersnapSpaceApiKey = getEnvSecrets().USERSNAP_SPACE_API_KEY;

  return (
    <html lang={locale} suppressHydrationWarning className={inter.className}>
      <head>
        {ucDataSettingsId && (
          <>
            <Script
              id="_before-gtm"
              dangerouslySetInnerHTML={{
                __html: `
                (function(w,l){
                  w[l]=w[l]||[];
                  w[l].push('consent','default',{'ad_personalization':'denied','ad_storage':'denied','ad_user_data':'denied','analytics_storage':'denied','wait_for_update':2000});
                })(window,'dataLayer');`,
              }}
              strategy="beforeInteractive"
            />
            <Script
              id="usercentrics-cmp"
              src="https://web.cmp.usercentrics.eu/ui/loader.js"
              {...(draftUserCentrics && { "data-draft": "true" })}
              data-settings-id={ucDataSettingsId}
              async
              strategy="beforeInteractive"
            />
          </>
        )}
        <ApplePwaHead />
      </head>
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      {gaId && <GoogleAnalytics gaId={gaId} />}
      <body className="bg-background min-h-svh max-w-dvw antialiased">
        <UsersnapProvider usersnapSpaceApiKey={usersnapSpaceApiKey}>
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
    </html>
  );
}
