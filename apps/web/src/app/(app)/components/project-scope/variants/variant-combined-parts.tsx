"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, Check, FolderKanban, Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";
import HeaderWorkspaceAvatar from "@/app/components/header/header-workspace-avatar";
import {
  useProjectScope,
  useProjectScopeSwitch,
} from "@/app/components/project-scope/use-project-scope";
import {
  useIsUnknownScopeProject,
  useScopeProjectReadFailed,
  useSelectedScopeProject,
} from "@/app/components/project-scope/use-scope-projects";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/auth.client";
import type { OrganizationRecord } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { loadCombinedWorkspaces } from "./variant-combined-actions";

const SKELETON_ROWS = 3;

/** The switch plus what a trigger shows: the scope's name and mark. */
export function useCombinedScope() {
  const t = useTranslations("App.ProjectScope");
  const scope = useProjectScopeSwitch();
  const selectedProject = useSelectedScopeProject(scope.projectId);
  const isUnknown = useIsUnknownScopeProject(scope.projectId);
  const readFailed = useScopeProjectReadFailed(scope.projectId);

  const name = scope.projectId
    ? (selectedProject?.name ?? t("label"))
    : t("workspaceView");
  // The avatar's fallback initial is text, so it would lead the trigger's name.
  const mark = (
    <span aria-hidden className="flex shrink-0">
      {selectedProject ? (
        <ProjectAvatar
          name={selectedProject.name}
          logo={selectedProject.logo}
          className="size-5 shrink-0"
        />
      ) : scope.projectId && !isUnknown && !readFailed ? (
        <Skeleton className="size-5 shrink-0 rounded-lg" />
      ) : scope.projectId ? (
        <FolderKanban className="size-4 shrink-0" />
      ) : (
        <Layers className="size-4 shrink-0" />
      )}
    </span>
  );

  return { ...scope, name, mark };
}

export interface CombinedWorkspace {
  /** Null is the personal workspace. */
  id: string | null;
  name: string;
  organization: OrganizationRecord | null;
}

/**
 * The header switcher's workspaces and its switch (`useWorkspaceSwitcher`).
 * A project belongs to one workspace, so switching drops the project scope.
 * Call it only inside open popover or sheet content: the read then runs when
 * the user opens the switcher, and every open lists fresh workspaces.
 */
export function useCombinedWorkspaces() {
  const t = useTranslations("Components.OrganizationSwitcher");
  const router = useRouter();
  const { data: session } = useSession();
  const { projectId, switchHref } = useProjectScope();
  const { isPending: isSwitching, handleSelectWorkspace } =
    useWorkspaceSwitcher();
  const userId = session?.user.id ?? null;

  const query = useQuery({
    queryKey: ["project-scope-combined-workspaces", userId],
    queryFn: () => loadCombinedWorkspaces({}),
    enabled: userId != null,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const activeId = session?.session.activeOrganizationId ?? null;
  const rows: CombinedWorkspace[] = [];
  if (session && query.data?.hasPersonalWorkspace) {
    rows.push({
      id: null,
      name: session.user.name ?? session.user.email ?? t("personalAccount"),
      organization: null,
    });
  }
  for (const member of query.data?.members ?? []) {
    rows.push({
      id: member.organization.id,
      name: member.organization.name,
      organization: member.organization,
    });
  }

  async function select(workspaceId: string | null) {
    if (workspaceId === activeId || isSwitching) return;
    const startedAt = currentLocation();
    try {
      await handleSelectWorkspace(workspaceId);
    } catch {
      // The switcher already logged it; the old workspace stays active.
      return;
    }
    // A navigation during the switch is a newer choice: keep it.
    if (projectId && currentLocation() === startedAt) {
      router.replace(switchHref(null));
    }
  }

  return {
    sessionUser: session?.user ?? null,
    rows,
    activeId,
    active: rows.find((row) => row.id === activeId) ?? null,
    isPending: session == null || query.isPending,
    isError: query.isError,
    refetch: () => void query.refetch(),
    isSwitching,
    select,
  };
}

function currentLocation(): string {
  return window.location.pathname + window.location.search;
}

export type CombinedWorkspaces = ReturnType<typeof useCombinedWorkspaces>;

/**
 * Holds the project list. While a workspace switch runs, the list still shows
 * the old workspace's projects, and each would lead to a 404 in the new one.
 */
export function SwitchingPane({
  isSwitching,
  className,
  children,
}: {
  isSwitching: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      inert={isSwitching}
      aria-busy={isSwitching || undefined}
      data-testid="project-scope-combined-project-pane"
      className={className}
    >
      {children}
    </div>
  );
}

export function WorkspaceMark({
  workspaces,
  workspace,
}: {
  workspaces: CombinedWorkspaces;
  workspace: CombinedWorkspace | null;
}) {
  if (workspaces.isPending) {
    return <Skeleton className="size-5 shrink-0 rounded-full" aria-hidden />;
  }
  if (!workspaces.sessionUser || !workspace) {
    return (
      <Building2
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    );
  }
  return (
    <HeaderWorkspaceAvatar
      sessionUser={workspaces.sessionUser}
      organization={workspace.organization}
      className="size-5 shrink-0 md:size-5"
      logoSize={12}
      decorative
    />
  );
}

/** The left pane: every workspace, the active one checked. */
export function WorkspaceList({
  workspaces,
  onChosen,
  className,
}: {
  workspaces: CombinedWorkspaces;
  onChosen?: () => void;
  className?: string;
}) {
  const t = useTranslations("Components.OrganizationSwitcher");
  const tScope = useTranslations("App.ProjectScope");
  const headingId = useId();

  return (
    <div className={cn("flex min-h-0 flex-col gap-1 p-1", className)}>
      <p
        id={headingId}
        className="text-muted-foreground px-2 py-1.5 text-xs font-medium"
      >
        {t("switchWorkspace")}
      </p>
      {/* Outside the list and always mounted, so a screen reader hears it. */}
      <div
        className={cn(
          "flex flex-col items-start gap-1 px-2",
          workspaces.isError && "py-1.5",
        )}
      >
        <p role="status" className="text-muted-foreground text-sm">
          {workspaces.isError ? tScope("workspacesError") : null}
        </p>
        {workspaces.isError ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mx-2"
            onClick={workspaces.refetch}
          >
            {tScope("retry")}
          </Button>
        ) : null}
      </div>
      {workspaces.isError ? null : workspaces.isPending ? (
        <div className="flex flex-col gap-1" aria-hidden>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} className="h-11 w-full rounded-sm md:h-8" />
          ))}
        </div>
      ) : (
        <ul
          aria-labelledby={headingId}
          aria-busy={workspaces.isSwitching}
          className="flex min-h-0 flex-col gap-0.5 overflow-y-auto"
        >
          {workspaces.rows.map((workspace) => {
            const isActive = workspace.id === workspaces.activeId;
            return (
              <li key={workspace.id ?? "personal"}>
                <button
                  type="button"
                  aria-current={isActive ? "true" : undefined}
                  // `disabled` would drop focus to the body mid-switch.
                  aria-disabled={workspaces.isSwitching || undefined}
                  data-testid={`project-scope-workspace-${workspace.id ?? "personal"}`}
                  onClick={() => {
                    if (workspaces.isSwitching) return;
                    void workspaces.select(workspace.id).then(onChosen);
                  }}
                  className="hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-hidden focus-visible:ring-2 aria-disabled:opacity-50 md:h-8"
                >
                  <WorkspaceMark
                    workspaces={workspaces}
                    workspace={workspace}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {workspace.name}
                  </span>
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
