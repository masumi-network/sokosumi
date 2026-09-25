"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { createContext, useContext } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";
import type { OrganizationWithLimitedInfo } from "@/lib/types/core-dto";

interface BreadcrumbSegment {
  label: string;
  href: string;
  isCurrent?: boolean;
}

interface BreadcrumbNavigationClientProps {
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

interface BreadcrumbLandmark {
  /**
   * False inside a parent breadcrumb: the crumbs render as bare items that
   * join its list, so one landmark holds the whole trail.
   */
  ownsLandmark: boolean;
  /** Rewrites each crumb's link, as a parent that keeps a project scope does. */
  mapHref?: (href: string) => string;
}

export const BreadcrumbLandmarkContext = createContext<BreadcrumbLandmark>({
  ownsLandmark: true,
});

const CHAT_ROOM_BREADCRUMB_LABEL_KEY = "__chatChannelLabel";
const CHAT_ROOM_BREADCRUMB_HREF_KEY = "__chatChannelHref";

export default function BreadcrumbNavigationClient({
  breadcrumbMessages,
  organizations,
  segmentLabels = {},
  className,
}: BreadcrumbNavigationClientProps) {
  const pathname = usePathname();
  const override = useBreadcrumbOverride();
  const { ownsLandmark, mapHref } = useContext(BreadcrumbLandmarkContext);

  const segments = resolveCurrentSegment(
    override?.pathname === pathname
      ? override.segments
      : generateSegments(
          pathname,
          segmentLabels,
          organizations,
          breadcrumbMessages,
        ),
  );

  const items = segments.map((segment, index) => (
    <React.Fragment key={`${segment.href}-${segment.label}-${index}`}>
      <BreadcrumbItem>
        {segment.isCurrent ? (
          <BreadcrumbPage>{segment.label}</BreadcrumbPage>
        ) : (
          <BreadcrumbLink asChild>
            <Link href={mapHref?.(segment.href) ?? segment.href}>
              {segment.label}
            </Link>
          </BreadcrumbLink>
        )}
      </BreadcrumbItem>
      {index < segments.length - 1 && <BreadcrumbSeparator />}
    </React.Fragment>
  ));

  if (!ownsLandmark) return items;

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>{items}</BreadcrumbList>
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
  organizations: OrganizationWithLimitedInfo[],
  breadcrumbMessages?: Record<string, string>,
): BreadcrumbSegment[] {
  const pathSegments = pathname.split("/").filter(Boolean);
  if (!pathSegments.length) return [];

  if (
    pathSegments[0] === "chat" &&
    pathSegments[1] === "rooms" &&
    pathSegments[2]
  ) {
    return generateChatRoomSegments(
      pathSegments[2],
      segmentLabels,
      breadcrumbMessages,
    );
  }

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
      // 2. Organization name resolution
      // 3. Translation key
      // 4. Fallback to the segment itself
      const organization = organizations.find(
        (o) => o.slug === decodeURIComponent(segment),
      );
      const isDesignMdEditor =
        segment === "edit" && pathSegments[index - 1] === "design-md";
      const label =
        segmentLabels[segment] ??
        (isDesignMdEditor ? breadcrumbMessages?.editor : undefined) ??
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

function generateChatRoomSegments(
  roomId: string,
  segmentLabels: Record<string, string>,
  breadcrumbMessages?: Record<string, string>,
): BreadcrumbSegment[] {
  const chatLabel = breadcrumbMessages?.chat ?? "Chat";
  const roomLabel = segmentLabels[CHAT_ROOM_BREADCRUMB_LABEL_KEY];
  const roomHref =
    segmentLabels[CHAT_ROOM_BREADCRUMB_HREF_KEY] ?? `/chat/rooms/${roomId}`;

  if (!roomLabel) {
    return [
      {
        label: chatLabel,
        href: "/",
        isCurrent: true,
      },
    ];
  }

  return [
    {
      label: chatLabel,
      href: "/",
    },
    {
      label: roomLabel,
      href: roomHref,
      isCurrent: true,
    },
  ];
}
