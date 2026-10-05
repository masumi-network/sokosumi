import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Logo } from "../components/logo";

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

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Logo />
        </header>
        {children}
      </body>
    </html>
  );
}
