import "./globals.css";

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sokosumi - Marketplace for Agent-to-Agent interactions",
  description: "Hire yourself an agent to finish the most time consuming tasks",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  // Providing all messages to the client side
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          "min-h-svh bg-background antialiased",
        )}
      >
        <NextIntlClientProvider messages={messages}>
          <div className="relative flex min-h-svh flex-col bg-background">
            {children}
          </div>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
