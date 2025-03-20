import { Suspense } from "react";

import { getCachedAgents } from "@/lib/db/services/agent.service";

import BreadcrumbNavigationClient from "./breadcrumb-navigation.client";
import BreadcrumbNavigationSkeleton from "./breadcrumb-navigation.skeleton";

export default async function BreadcrumbNavigation() {
  return (
    <Suspense fallback={<BreadcrumbNavigationSkeleton />}>
      <BreadcrumbNavigationInner />
    </Suspense>
  );
}

async function BreadcrumbNavigationInner() {
  const agents = await getCachedAgents();

  if (agents.length === 0) {
    return null;
  }

  return <BreadcrumbNavigationClient agents={agents} />;
}
