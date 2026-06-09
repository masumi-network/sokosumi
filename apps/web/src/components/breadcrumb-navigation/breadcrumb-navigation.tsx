import type { AgentWithRelations } from "@sokosumi/database";
import { organizationRepository } from "@sokosumi/database/repositories";
import { getMessages } from "next-intl/server";
import { Suspense } from "react";

import { mapCoreAgentsToAgentWithCreditsPrice } from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents } from "@/lib/agents/core-loaders";
import prisma from "@/lib/db/prisma";

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
  // served by Core (cached) and organizations from the DB; each lookup degrades
  // to an empty fallback independently rather than blowing up the app shell
  // with an unhandled server-component throw.
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
    // Known intermittent: Neon's serverless pooler cold-starts and the query
    // trips its short timeout. Page renders fine with an empty fallback;
    // logging — not Sentry-capturing — so the dev-overlay doesn't surface this
    // every cold start.
    organizationRepository
      .listOrganizationsWithLimitedInfo(prisma)
      .catch((error) => {
        console.warn(
          "[breadcrumb] organization lookup timed out, using empty fallback",
          { message: (error as Error)?.message },
        );
        return [];
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
