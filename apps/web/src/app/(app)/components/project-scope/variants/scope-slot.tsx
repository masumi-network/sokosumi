"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useRef } from "react";
import { isProjectScopedPath } from "@/app/components/project-scope/project-scope-href";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import {
  SCOPE_SELECTED_QUERY_KEY,
  useIsUnknownScopeProject,
} from "@/app/components/project-scope/use-scope-projects";

import type {
  ScopeSlotPlace,
  ScopeSlotProps,
  ScopeSlots,
  ScopeVariantId,
} from "./scope-variants";
import {
  useReplacesOldProjectNavigation,
  useScopeVariant,
} from "./use-scope-variant";
import { combinedSlots } from "./variant-combined";
import { commandSlots } from "./variant-command";
import { headerSlots } from "./variant-header";
import { hubSlots } from "./variant-hub";
import { sidebarSlots } from "./variant-sidebar";

const SLOTS: Record<ScopeVariantId, ScopeSlots> = {
  current: {},
  sidebar: sidebarSlots,
  header: headerSlots,
  combined: combinedSlots,
  command: commandSlots,
  hub: hubSlots,
};

interface ScopeSlotMountProps extends ScopeSlotProps {
  place: ScopeSlotPlace;
}

function ActiveSlot({ place, ...props }: ScopeSlotMountProps) {
  const Slot = SLOTS[useScopeVariant()][place];
  return Slot ? <Slot {...props} /> : null;
}

/** A mount point in the app chrome. Renders the active variant's piece. */
export function ScopeSlot(props: ScopeSlotMountProps) {
  return (
    <Suspense fallback={null}>
      <ActiveSlot {...props} />
    </Suspense>
  );
}

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

/**
 * Keeps the triggers honest. It drops a project the workspace does not have
 * from a scoped page's URL, as after a workspace switch that kept
 * `?projectId=`: the page already ignores it, but every variant would still
 * name and link it. Project pages 404 on their own. It also refreshes the
 * scoped project's name after each navigation.
 */
export function ScopeStaleGuard() {
  return (
    <Suspense fallback={null}>
      <StaleGuardGate />
    </Suspense>
  );
}

function StaleGuardGate() {
  return useReplacesOldProjectNavigation() ? <StaleScopeGuard /> : null;
}

function OldWay({ children }: { children: ReactNode }) {
  return useReplacesOldProjectNavigation() ? null : children;
}

/**
 * Today's project navigation. Every new variant replaces it, so it renders
 * only on the `current` baseline.
 */
export function ScopeOldWay({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <OldWay>{children}</OldWay>
    </Suspense>
  );
}
