import { redirect } from "next/navigation";

import { ConnectionsPage } from "./components/connections-page";

interface ConnectionsRouteProps {
  searchParams: Promise<{
    tab?: string | string[];
  }>;
}

const DEVELOPER_LEGACY_TABS = new Set(["api-keys", "mcp"]);

export default async function ConnectionsRoute({
  searchParams,
}: ConnectionsRouteProps) {
  const params = await searchParams;
  const tabValue = Array.isArray(params.tab) ? params.tab[0] : params.tab;

  if (tabValue && DEVELOPER_LEGACY_TABS.has(tabValue)) {
    redirect(`/developer?tab=${tabValue}`);
  }

  return <ConnectionsPage />;
}
