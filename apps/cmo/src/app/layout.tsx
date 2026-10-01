import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Logo } from "../components/logo";

export const metadata: Metadata = {
  title: "CMO.XYZ",
  description:
    "An AI agent that automates a business's marketing, end to end, in one system.",
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
