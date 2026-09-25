"use client";

import { useContext } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";

import { BreadcrumbLandmarkContext } from "./breadcrumb-navigation.client";

export default function BreadcrumbNavigationSkeleton({
  className,
}: {
  className?: string;
}) {
  const ownsLandmark = useContext(BreadcrumbLandmarkContext);
  const items = (
    <>
      <BreadcrumbItem>
        <Skeleton className="h-3 w-12" />
      </BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        <Skeleton className="h-3 w-12" />
      </BreadcrumbItem>
    </>
  );

  // Inside a list that owns the landmark, as in a header variant.
  if (!ownsLandmark) return items;

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>{items}</BreadcrumbList>
    </Breadcrumb>
  );
}
