import "./globals.css";

import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { Logo } from "../components/logo";
import { readTheme, THEME_COOKIE } from "../lib/theme";

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
      path: "../../public/site/assets/fonts/mori-regular.woff2",
      weight: "300 500",
    },
    {
      path: "../../public/site/assets/fonts/mori-semibold.woff2",
      weight: "600 800",
    },
  ],
  variable: "--font-mori",
});

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const theme = readTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={mori.variable} data-theme={theme ?? undefined}>
      <body>
        <header className="site-header">
          <Logo />
        </header>
        {children}
      </body>
    </html>
  );
}
