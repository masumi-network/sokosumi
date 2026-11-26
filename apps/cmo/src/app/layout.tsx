import "./globals.css";

import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { Analytics } from "../components/analytics";
import { Logo } from "../components/logo";
import { analyticsConsent, CONSENT_COOKIE } from "../lib/analytics";
import { getAuth } from "../lib/auth";
import { readTheme, THEME_COOKIE } from "../lib/theme";
import { readAnalyticsUser } from "./actions";

export const metadata: Metadata = {
  title: "CMO.xyz",
  description:
    "An AI agent that automates a business's marketing, end to end, in one system.",
  // In public/ so each icon keeps a stable URL others can link to.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
  },
};

// PP Mori, through --font-sans (design-system.md). Its two cuts cover every
// weight in use, so the browser never fakes a bold.
const mori = localFont({
  src: [
    {
      path: "../../public/fonts/mori-regular.woff2",
      weight: "300 500",
    },
    {
      path: "../../public/fonts/mori-semibold.woff2",
      weight: "600 800",
    },
  ],
  variable: "--font-mori",
});

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const theme = readTheme(cookieStore.get(THEME_COOKIE)?.value);
  const consent = analyticsConsent(
    cookieStore.get(CONSENT_COOKIE)?.value,
    requestHeaders.get("x-vercel-ip-country"),
  );
  // Pages that need no sign-in still render when auth is not configured.
  const session = await Promise.resolve()
    .then(() => getAuth().api.getSession({ headers: requestHeaders }))
    .catch(() => null);
  return (
    <html lang="en" className={mori.variable} data-theme={theme ?? undefined}>
      <body>
        <header className="site-header">
          <Logo />
        </header>
        {children}
        <Analytics
          consent={consent}
          signedIn={session !== null}
          readUser={readAnalyticsUser}
        />
      </body>
    </html>
  );
}
