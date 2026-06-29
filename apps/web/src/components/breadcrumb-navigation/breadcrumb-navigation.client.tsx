"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getAgentName } from "@/lib/helpers/agent";
import type {
  CoreAgentDto,
  OrganizationWithLimitedInfo,
} from "@/lib/types/core-dto";

interface BreadcrumbSegment {
  label: string;
  href: string;
  isCurrent?: boolean;
}

interface BreadcrumbNavigationClientProps {
  /**
   * Agents for resolving agent IDs to names
   */
  agents: CoreAgentDto[];
  /**
   * Messages for resolving path segments to their display labels
   */
  breadcrumbMessages?: Record<string, string>;
  /**
   * Organizations for resolving organization IDs to names
   */
  organizations: OrganizationWithLimitedInfo[];
  /**
   * Optional map of path segments to their display labels
   */
  segmentLabels?: Record<string, string>;
  className?: string | undefined;
}

export default function BreadcrumbNavigationClient({
  agents,
  breadcrumbMessages,
  organizations,
  segmentLabels = {},
  className,
}: BreadcrumbNavigationClientProps) {
  const pathname = usePathname();

  const segments = resolveCurrentSegment(
    generateSegments(
      pathname,
      segmentLabels,
      agents,
      organizations,
      breadcrumbMessages,
    ),
  );

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {segments.map((segment, index) => (
          <React.Fragment key={segment.href}>
            <BreadcrumbItem>
              {segment.isCurrent ? (
                <BreadcrumbPage>{segment.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={segment.href}>{segment.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {index < segments.length - 1 && <BreadcrumbSeparator />}
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function resolveCurrentSegment(
  segments: BreadcrumbSegment[],
): BreadcrumbSegment[] {
  if (segments.length === 0 || segments.some((segment) => segment.isCurrent)) {
    return segments;
  }

  return segments.map((segment, index) => ({
    ...segment,
    isCurrent: index === segments.length - 1,
  }));
}

function generateSegments(
  pathname: string,
  segmentLabels: Record<string, string>,
  agents: CoreAgentDto[],
  organizations: OrganizationWithLimitedInfo[],
  breadcrumbMessages?: Record<string, string>,
): BreadcrumbSegment[] {
  const pathSegments = pathname.split("/").filter(Boolean);
  if (!pathSegments.length) return [];

  return pathSegments
    .map((segment, index) => {
      const href = "/" + pathSegments.slice(0, index + 1).join("/");
      const isCurrent = index === pathSegments.length - 1;

      // check for special cases
      if (href.startsWith("/accept-invitation")) return;

      if (segment === "conversation") return;

      // design-md is a route segment only — hide it from breadcrumbs (Account > Editor).
      if (segment === "design-md") return;

      // No org overview page — /organizations/* hides the parent segment (SOK-546).
      // Admin org routes keep it for Admin > Organizations > {name}.
      if (segment === "organizations" && pathSegments[0] === "organizations") {
        return;
      }

      // Skip UUIDs and long IDs in breadcrumbs (they're not user-friendly)
      // UUIDs are typically 36 characters with dashes, or 32 hex characters
      // Conversation IDs follow UUID format
      const isLikelyId =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          segment,
        ) || /^[0-9a-f]{32}$/i.test(segment);
      if (isLikelyId && !segmentLabels[segment]) {
        // Skip showing raw IDs unless there's a custom label
        return;
      }

      // Try to resolve the segment label in the following order:
      // 1. Custom segment labels map
      // 2. Agent name resolution
      // 3. Organization name resolution
      // 4. Translation key
      // 5. Fallback to the segment itself
      const agent = agents.find((a) => a.id === segment);
      const organization = organizations.find(
        (o) => o.slug === decodeURIComponent(segment),
      );
      const isDesignMdEditor =
        segment === "edit" && pathSegments[index - 1] === "design-md";
      const label =
        segmentLabels[segment] ??
        (isDesignMdEditor ? breadcrumbMessages?.editor : undefined) ??
        (agent && getAgentName(agent)) ??
        (organization && organization.name) ??
        (breadcrumbMessages && segment in breadcrumbMessages
          ? breadcrumbMessages[segment]
          : segment);

      return {
        label,
        href,
        isCurrent,
      };
    })
    .filter(Boolean) as BreadcrumbSegment[];
}
