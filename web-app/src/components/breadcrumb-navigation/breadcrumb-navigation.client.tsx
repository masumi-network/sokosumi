"use client";

import Link from "next/link";
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
import { AgentWithRelations, getAgentName } from "@/lib/db";

interface BreadcrumbSegment {
  label: string;
  href: string;
  isCurrent?: boolean;
}

interface BreadcrumbNavigationClientProps {
  /**
   * Optional map of path segments to their display labels
   */
  segmentLabels?: Record<string, string>;
  /**
   * Agents for resolving agent IDs to names
   */
  agents: AgentWithRelations[];
  className?: string | undefined;
}

export default function BreadcrumbNavigationClient({
  segmentLabels = {},
  agents,
  className,
}: BreadcrumbNavigationClientProps) {
  const pathname = usePathname();
  const t = useTranslations("Components.Breadcrumb");

  const segments = generateSegments(pathname, segmentLabels, agents, t).filter(
    (segment) => segment.href !== "/app",
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

function generateSegments(
  pathname: string,
  segmentLabels: Record<string, string>,
  agents: AgentWithRelations[],
  t?: IntlTranslation<"Components.Breadcrumb">,
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
      (agent && getAgentName(agent)) ??
      (t && t.has(segment) ? t(segment) : segment);

    return {
      label,
      href,
      isCurrent,
    };
  });
}
