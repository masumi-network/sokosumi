import { redirect } from "next/navigation";

import { DeveloperPage } from "./components/developer-page";

interface DeveloperRouteProps {
  searchParams: Promise<{
    tab?: string | string[];
  }>;
}

export default async function DeveloperRoute({
  searchParams,
}: DeveloperRouteProps) {
  const params = await searchParams;
  const tabValue = Array.isArray(params.tab) ? params.tab[0] : params.tab;

  // MCP stays under Connections.
  if (tabValue === "mcp") {
    redirect("/connections?tab=mcp");
  }

  return <DeveloperPage />;
}
