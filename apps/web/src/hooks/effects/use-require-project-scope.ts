"use client";

import { useEffect } from "react";

import {
  openProjectScope,
  type ProjectScopeRequest,
} from "@/app/components/project-scope/sidebar-project-scope-state";

/**
 * Opens the required project scope selector when `RequireProjectScope` mounts
 * and closes it via the returned cleanup on unmount or Activity hide.
 */
export function useRequireProjectScope(
  request: Omit<ProjectScopeRequest, "required">,
): void {
  useEffect(() => openProjectScope({ ...request, required: true }), []);
}
