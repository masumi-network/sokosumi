"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { isProjectScopedPath } from "@/app/components/project-scope/project-scope-href";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import {
  SCOPE_SELECTED_QUERY_KEY,
  useIsUnknownScopeProject,
} from "@/app/components/project-scope/use-scope-projects";

function StaleScopeGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const { projectId, switchHref } = useProjectScope();
  const scopedPage = isProjectScopedPath(pathname);
  const unknown = useIsUnknownScopeProject(scopedPage ? projectId : null);
  const target = unknown ? switchHref(null) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  // A rename or new logo lands with a navigation, as the edit form pushes
  // back to the project. Every trigger then asks again.
  const queryClient = useQueryClient();
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    void queryClient.invalidateQueries({
      queryKey: [SCOPE_SELECTED_QUERY_KEY],
    });
  }, [pathname, queryClient]);
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
