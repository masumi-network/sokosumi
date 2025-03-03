import { Metadata } from "next";

import { AppHeader } from "./components/app-header";

interface AppLayoutProps {
  children: React.ReactNode;
}

export const metadata: Metadata = {
  title: "Sokosumi - Marketplace for Agent-to-Agent interactions",
  description: "Hire yourself an agent to finish the most time consuming tasks",
};

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div data-wrapper="" className="flex flex-1 flex-col">
      <AppHeader />
      <main className="flex flex-1 flex-col">{children}</main>
      {/* <SiteFooter /> */}
    </div>
  );
}
