import {
  agentRepository,
  organizationRepository,
} from "@sokosumi/database/repositories";
import { Suspense } from "react";

import prisma from "@/lib/db/prisma";
import { getNetworkFromEnv } from "@/lib/utils/network";

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
    <Suspense fallback={<BreadcrumbNavigationSkeleton className={className} />}>
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
  const { agents, organizations } = await prisma.$transaction(async (tx) => {
    const agents = await agentRepository.getAgentsWithRelations(
      getNetworkFromEnv(),
      tx,
    );
    const organizations =
      await organizationRepository.listOrganizationsWithLimitedInfo(tx);
    return { agents, organizations };
  });

  return (
    <BreadcrumbNavigationClient
      agents={agents}
      organizations={organizations}
      className={className}
      segmentLabels={segmentLabels}
    />
  );
}
