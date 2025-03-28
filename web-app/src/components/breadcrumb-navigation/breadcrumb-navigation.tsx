import { Suspense } from "react";

import { getAgents } from "@/lib/db/services/agent.service";

import BreadcrumbNavigationClient from "./breadcrumb-navigation.client";
import BreadcrumbNavigationSkeleton from "./breadcrumb-navigation.skeleton";

interface BreadcrumbNavigationProps {
  className?: string;
}

export default async function BreadcrumbNavigation({
  className,
}: BreadcrumbNavigationProps) {
  return (
    <Suspense fallback={<BreadcrumbNavigationSkeleton />}>
      <BreadcrumbNavigationInner className={className} />
    </Suspense>
  );
}

async function BreadcrumbNavigationInner({
  className,
}: {
  className?: string | undefined;
}) {
  const agents = await getAgents();

  if (agents.length === 0) {
    return null;
  }

  return <BreadcrumbNavigationClient agents={agents} className={className} />;
}
