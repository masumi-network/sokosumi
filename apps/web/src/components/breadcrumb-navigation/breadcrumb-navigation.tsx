import {
  agentRepository,
  organizationRepository,
} from "@sokosumi/database/repositories";
import { getMessages } from "next-intl/server";
import { Suspense } from "react";

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
  const [messages, { agents, organizations }] = await Promise.all([
    getMessages(),
    prisma.$transaction(async (tx) => {
      const agents = await agentRepository.getAgentsWithRelations(tx);
      const organizations =
        await organizationRepository.listOrganizationsWithLimitedInfo(tx);
      return { agents, organizations };
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
