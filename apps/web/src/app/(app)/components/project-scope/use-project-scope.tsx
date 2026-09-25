"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";

import {
  readProjectScope,
  scopedHref,
  switchScopeHref,
} from "./project-scope-href";

/** The reader's project scope, read from the URL. */
export function useProjectScope() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Null outside the App Router, as in component tests.
  const projectId = readProjectScope(
    pathname,
    searchParams ?? new URLSearchParams(),
  );

  return {
    projectId,
    /** A navigation link that keeps the current scope. */
    hrefFor: (href: string) => scopedHref(href, projectId),
    /** Where choosing a project, or the workspace as null, leads. */
    switchHref: (nextProjectId: string | null) =>
      switchScopeHref(pathname, nextProjectId),
  };
}

/**
 * The switch itself, shared by every switcher: navigate on a choice, and own
 * the Create project dialog. The dialog outlives the popover or sheet that
 * opened it, so render `createDialog` beside that container, not inside it.
 */
export function useProjectScopeSwitch() {
  const router = useRouter();
  const scope = useProjectScope();
  const [createOpen, setCreateOpen] = useState(false);

  function select(nextProjectId: string | null) {
    router.push(scope.switchHref(nextProjectId));
  }

  const createDialog = (
    <InlineCreateProjectModal
      open={createOpen}
      onOpenChange={setCreateOpen}
      onCreated={({ projectId }) => select(projectId)}
    />
  );

  return {
    ...scope,
    select,
    openCreate: () => setCreateOpen(true),
    createDialog,
  };
}
