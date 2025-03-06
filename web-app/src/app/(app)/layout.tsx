import { Metadata } from "next";

import AppHeader from "./components/app-header";
import { MainLeftPanel } from "./components/left-panel";

interface AppLayoutProps {
  children: React.ReactNode;
}

export const metadata: Metadata = {
  title: "Sokosumi - Marketplace for Agent-to-Agent interactions",
  description: "Hire yourself an agent to finish the most time consuming tasks",
};

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div data-wrapper="" className="flex h-svh flex-1 flex-col">
      <AppHeader />
      <main className="flex h-[calc(100svh-64px)] flex-1 flex-col md:flex-row">
        <MainLeftPanel />
        <div className="flex flex-1 flex-col">{children}</div>
      </main>
      {/* <SiteFooter /> */}
    </div>
  );
}
