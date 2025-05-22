import "./globals.css";

import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import PlausibleProvider from "next-plausible";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { Toaster } from "@/components/ui/sonner";
import { UsersnapProvider } from "@/components/usersnap/usersnap-provider";
import { getEnvSecrets } from "@/config/env.config";
import { ThemeProvider } from "@/lib/context/theme-context";
import { cn } from "@/lib/utils";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <PlausibleProvider
          domain={getEnvSecrets().PLAUSIBLE_DOMAIN}
          trackOutboundLinks={true}
          trackFileDownloads={true}
          hash={true}
        />
      </head>
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          "bg-background min-h-svh max-w-dvw antialiased",
        )}
      >
        <Script src="/js/plain.js" strategy="afterInteractive" />
        <UsersnapProvider>
          <NuqsAdapter>
            <ThemeProvider>
              <NextIntlClientProvider messages={messages}>
                <div className="bg-background">{children}</div>
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
