import { redirect } from "next/navigation";

import { ConnectionsPage } from "./components/connections-page";

interface ConnectionsRouteProps {
  searchParams: Promise<{
    tab?: string | string[];
  }>;
}

export default async function ConnectionsRoute({
  searchParams,
}: ConnectionsRouteProps) {
  const params = await searchParams;
  const tabValue = Array.isArray(params.tab) ? params.tab[0] : params.tab;

  // API keys moved to Developer; keep MCP on Connections.
  if (tabValue === "api-keys") {
    redirect("/developer?tab=api-keys");
  }

  return <ConnectionsPage />;
}
