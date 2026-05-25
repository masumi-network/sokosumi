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
  // Breadcrumb labels are nice-to-have, not load-bearing. If the DB
  // transaction times out (Neon cold-start, pool exhaustion, etc.) we'd
  // rather render breadcrumbs with raw URL segments than blow up the whole
  // app shell with an unhandled server-component throw.
  const [messages, lookups] = await Promise.all([
    getMessages(),
    prisma
      .$transaction(async (tx) => {
        const agents = await agentRepository.getAgentsWithRelations(tx);
        const organizations =
          await organizationRepository.listOrganizationsWithLimitedInfo(tx);
        return { agents, organizations };
      })
      .catch((error) => {
        // Known intermittent: Neon's serverless pooler cold-starts and the
        // multi-query transaction trips its short timeout. Page renders fine
        // with empty fallbacks; logging — not Sentry-capturing — so the
        // dev-overlay doesn't surface this every cold start.
        console.warn("[breadcrumb] lookups timed out, using empty fallback", {
          message: (error as Error)?.message,
        });
        return { agents: [], organizations: [] };
      }),
  ]);
  const { agents, organizations } = lookups;

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
