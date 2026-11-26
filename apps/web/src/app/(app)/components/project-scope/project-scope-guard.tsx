"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  clearedScopeHref,
  isProjectScopedPath,
} from "@/app/components/project-scope/project-scope-href";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { useIsUnknownScopeProject } from "@/app/components/project-scope/use-scope-projects";
import { useInvalidateProjectScopeOnNavigation } from "@/hooks/effects/use-invalidate-project-scope-on-navigation";
import { useRouterRedirect } from "@/hooks/effects/use-router-redirect";

function StaleScopeGuard() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { projectId } = useProjectScope();
  const scopedPage = isProjectScopedPath(pathname);
  const unknown = useIsUnknownScopeProject(scopedPage ? projectId : null);
  // Null outside the App Router, as in component tests.
  const target = unknown
    ? clearedScopeHref(pathname, searchParams ?? new URLSearchParams())
    : null;

  useRouterRedirect(target);

  // A rename or new logo lands with a navigation, as the edit form pushes
  // back to the project. Every trigger then asks again.
  useInvalidateProjectScopeOnNavigation(pathname);
  return null;
}

/** Clear inaccessible scope after a workspace switch and refresh project names. */
export function ProjectScopeGuard() {
  return (
    <Suspense fallback={null}>
      <StaleScopeGuard />
    </Suspense>
  );
}
