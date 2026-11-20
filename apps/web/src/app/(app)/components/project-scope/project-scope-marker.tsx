"use client";

import { usePathname } from "next/navigation";
import {
  useMarkedProjectSnapshot,
  useProjectScopeMarker,
} from "@/hooks/effects/use-project-scope-marker";

import { detailPageOf } from "./project-scope-href";

/**
 * A task or schedule detail page reports its item's
 * project, which its URL does not carry. Renders nothing.
 */
export function ProjectScopeMarker({
  projectId,
}: {
  projectId: string | null;
}) {
  const path = detailPageOf(usePathname())?.path ?? null;

  useProjectScopeMarker(path, projectId);

  return null;
}

/**
 * The project a detail page marked, for the detail page at `pathname` only.
 * Null when the item has no project; undefined until this page reports one.
 */
export function useMarkedProjectId(
  pathname: string,
): string | null | undefined {
  const current = useMarkedProjectSnapshot();
  const path = detailPageOf(pathname)?.path;
  return current && current.path === path ? current.projectId : undefined;
}
