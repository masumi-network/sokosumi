import { Suspense } from "react";

import { getOnlineAgents } from "@/lib/db";

import BreadcrumbNavigationClient from "./breadcrumb-navigation.client";
import BreadcrumbNavigationSkeleton from "./breadcrumb-navigation.skeleton";

interface BreadcrumbNavigationProps {
  className?: string;
  /**
   * Optional map of path segments to their display labels
   */
  segmentLabels?: Record<string, string>;
}

export default async function BreadcrumbNavigation({
  className,
  segmentLabels,
}: BreadcrumbNavigationProps) {
  return (
    <Suspense fallback={<BreadcrumbNavigationSkeleton />}>
      <BreadcrumbNavigationInner
        className={className}
        segmentLabels={segmentLabels}
      />
    </Suspense>
  );
}

async function BreadcrumbNavigationInner({
  className,
  segmentLabels,
}: {
  className?: string | undefined;
  segmentLabels?: Record<string, string>;
}) {
  const agents = await getOnlineAgents();

  return (
    <BreadcrumbNavigationClient
      agents={agents}
      className={className}
      segmentLabels={segmentLabels}
    />
  );
}
