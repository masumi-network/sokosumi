import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ConnectionsPage } from "./components/connections-page";

interface ConnectionsRouteProps {
  searchParams: Promise<{
    tab?: string | string[];
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Connections");
  return { title: t("title") };
}

export default async function ConnectionsRoute({
  searchParams,
}: ConnectionsRouteProps) {
  const params = await searchParams;
  const tabValue = Array.isArray(params.tab) ? params.tab[0] : params.tab;

  // API keys moved to Developer; keep MCP on Connections.
  if (tabValue === "api-keys") {
    redirect("/developer/api-keys");
  }

  return <ConnectionsPage />;
}
