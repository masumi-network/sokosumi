import { Metadata } from "next";
import { cookies } from "next/headers";

import { SidebarProvider } from "@/components/ui/sidebar";

import Header from "./components/header";
import Sidebar from "./components/sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export const metadata: Metadata = {
  title: "Sokosumi - Marketplace for Agent-to-Agent interactions",
  description: "Hire yourself an agent to finish the most time consuming tasks",
};

export default async function AppLayout({ children }: AppLayoutProps) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar />
      <div className="flex h-svh flex-1 flex-col">
        <Header className="h-[64px]" />
        <main className="flex h-[calc(100svh-64px)] flex-1 flex-col md:flex-row">
          <div className="flex flex-1 flex-col">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
