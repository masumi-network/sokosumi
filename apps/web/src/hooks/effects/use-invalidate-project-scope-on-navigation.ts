"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { SCOPE_SELECTED_QUERY_KEY } from "@/app/components/project-scope/use-scope-projects";

/**
 * Invalidates the selected project-scope query whenever `pathname` changes
 * after mount (for example, returning from editing a project's name or logo).
 */
export function useInvalidateProjectScopeOnNavigation(pathname: string): void {
  const queryClient = useQueryClient();
  const lastPathname = useRef(pathname);

  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    void queryClient.invalidateQueries({
      queryKey: [SCOPE_SELECTED_QUERY_KEY],
    });
  }, [pathname, queryClient]);
}
