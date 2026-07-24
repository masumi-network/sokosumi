import { redirect } from "next/navigation";

import {
  DEVELOPER_DEFAULT_HREF,
  DEVELOPER_TAB_REDIRECTS,
} from "@/app/components/sidebar/components/developer-menu-config";

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

  if (tabValue && tabValue in DEVELOPER_TAB_REDIRECTS) {
    redirect(DEVELOPER_TAB_REDIRECTS[tabValue]);
  }

  redirect(DEVELOPER_DEFAULT_HREF);
}
