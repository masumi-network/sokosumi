import type {
  AgentWithRelations,
  OrganizationWithLimitedInfo,
} from "@sokosumi/database";
import { getMessages } from "next-intl/server";
import { Suspense } from "react";

import { mapCoreAgentsToAgentWithCreditsPrice } from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents } from "@/lib/agents/core-loaders";
import { coreClient } from "@/lib/clients/core.client";

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
  // Breadcrumb labels are nice-to-have, not load-bearing. The agent catalog is
  // served by Core (cached) and organizations from the user's memberships;
  // each lookup degrades to an empty fallback independently rather than blowing
  // up the app shell with an unhandled server-component throw.
  const [messages, agents, organizations] = await Promise.all([
    getMessages(),
    getAllCoreAgents()
      .then(mapCoreAgentsToAgentWithCreditsPrice)
      .catch((error) => {
        console.warn(
          "[breadcrumb] agent catalog fetch failed, using empty fallback",
          { message: (error as Error)?.message },
        );
        return [] as AgentWithRelations[];
      }),
    coreClient
      .getMyOrganizations()
      .then((response) =>
        response.data.map(
          (organization): OrganizationWithLimitedInfo => ({
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
          }),
        ),
      )
      .catch((error) => {
        console.warn(
          "[breadcrumb] organization lookup failed, using empty fallback",
          { message: (error as Error)?.message },
        );
        return [] as OrganizationWithLimitedInfo[];
      }),
  ]);

  const breadcrumbMessages = (messages?.Components as Record<string, unknown>)
    ?.Breadcrumb as Record<string, string> | undefined;

  return (
    <BreadcrumbNavigationClient
      agents={agents}
      breadcrumbMessages={breadcrumbMessages}
      organizations={organizations}
      className={className}
      segmentLabels={segmentLabels}
    />
  );
}
