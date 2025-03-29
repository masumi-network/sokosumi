"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import React from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";

interface BreadcrumbSegment {
  label: string;
  href: string;
  isCurrent?: boolean;
}

interface BreadcrumbNavigationClientProps {
  /**
   * Optional segments to override the default path-based segments
   */
  segments?: BreadcrumbSegment[];
  /**
   * Optional map of path segments to their display labels
   */
  segmentLabels?: Record<string, string>;
  /**
   * Agents for resolving agent IDs to names
   */
  agents: AgentDTO[];
  className?: string | undefined;
}

export default function BreadcrumbNavigationClient({
  segments: customSegments,
  segmentLabels = {},
  agents,
  className,
}: BreadcrumbNavigationClientProps) {
  const pathname = usePathname();
  const t = useTranslations("Navigation");

  const segments =
    customSegments ?? generateSegments(pathname, segmentLabels, agents, t);

  // Only show breadcrumb if there are 2 or more segments
  if (segments.length < 2) {
    return null;
  }

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {segments.map((segment, index) => (
          <React.Fragment key={segment.href}>
            <BreadcrumbItem>
              {segment.isCurrent ? (
                <BreadcrumbPage>{segment.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={segment.href}>
                  {segment.label}
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

function generateSegments(
  pathname: string,
  segmentLabels: Record<string, string>,
  agents: AgentDTO[],
  t?: IntlTranslation<"Navigation">,
): BreadcrumbSegment[] {
  const pathSegments = pathname.split("/").filter(Boolean);
  if (!pathSegments.length) return [];

  return pathSegments.map((segment, index) => {
    const href = "/" + pathSegments.slice(0, index + 1).join("/");
    const isCurrent = index === pathSegments.length - 1;

    // Try to resolve the segment label in the following order:
    // 1. Custom segment labels map
    // 2. Agent name resolution
    // 3. Translation key
    // 4. Fallback to the segment itself
    const agent = agents.find((a) => a.id === segment);
    const label =
      segmentLabels[segment] ??
      agent?.name ??
      (t && t.has(segment) && t(segment)) ??
      segment;

    return {
      label,
      href,
      isCurrent,
    };
  });
}
