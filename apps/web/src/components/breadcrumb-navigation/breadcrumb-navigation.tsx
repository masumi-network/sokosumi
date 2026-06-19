import { headers } from "next/headers";
import { getMessages } from "next-intl/server";
import { Suspense } from "react";
import { getAllCoreAgents } from "@/lib/agents/core-loaders";
import type { Agent } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services";
import { adminOrganizationService } from "@/lib/services/admin-organization.service";
import type { OrganizationWithLimitedInfo } from "@/lib/types/core-dto";

import BreadcrumbNavigationClient from "./breadcrumb-navigation.client";
import BreadcrumbNavigationSkeleton from "./breadcrumb-navigation.skeleton";

interface BreadcrumbNavigationProps {
  className?: string;
  segmentLabels?: Record<string, string>;
}

const ADMIN_ORGANIZATION_DETAIL_PATH = /^\/admin\/organizations\/([^/]+)\/?$/;

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
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";
  const resolvedSegmentLabels = await resolveSegmentLabels(
    pathname,
    segmentLabels,
  );

  const [messages, agents, organizations] = await Promise.all([
    getMessages(),
    getAllCoreAgents().catch((error) => {
      console.warn(
        "[breadcrumb] agent catalog fetch failed, using empty fallback",
        { message: (error as Error)?.message },
      );
      return [] as Agent[];
    }),
    userService
      .getMyMembersWithOrganizations()
      .then((members) =>
        members
          .map(
            ({ organization }): OrganizationWithLimitedInfo => ({
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
            }),
          )
          .filter(
            (org): org is OrganizationWithLimitedInfo => org.slug != null,
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
      segmentLabels={resolvedSegmentLabels}
    />
  );
}

async function resolveSegmentLabels(
  pathname: string,
  segmentLabels?: Record<string, string>,
): Promise<Record<string, string>> {
  const labels = { ...segmentLabels };
  const match = pathname.match(ADMIN_ORGANIZATION_DETAIL_PATH);
  if (!match) {
    return labels;
  }

  const slug = decodeURIComponent(match[1]);
  if (labels[slug]) {
    return labels;
  }

  try {
    const organization =
      await adminOrganizationService.getOrganizationOptionBySlug(slug);
    if (organization) {
      labels[slug] = organization.name;
    }
  } catch (error) {
    console.warn(
      "[breadcrumb] admin organization lookup failed, using slug fallback",
      { message: (error as Error)?.message, slug },
    );
  }

  return labels;
}
