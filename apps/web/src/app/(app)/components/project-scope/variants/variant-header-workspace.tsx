"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import HeaderWorkspaceAvatar from "@/app/components/header/header-workspace-avatar";
import { HeaderWorkspaceLabel } from "@/app/components/header/header-workspace-label";
import { useCreateWorkspace } from "@/app/components/header/use-create-workspace";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { authClient, useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

import {
  useCombinedWorkspaces,
  useScopedWorkspaceSwitch,
  WorkspaceList,
  type WorkspaceSwitcher,
} from "./variant-combined-parts";

/**
 * The active workspace's name, from the session and the organization list.
 * Null while either loads.
 */
export function useWorkspaceName(): string | null {
  const t = useTranslations("App.ProjectScope");
  const tSwitcher = useTranslations("Components.OrganizationSwitcher");
  const { data: session, error: sessionError } = useSession();
  const { data: organizations, error } = authClient.useListOrganizations();
  if (!session) return sessionError ? t("workspace") : null;
  const organizationId = session.session.activeOrganizationId ?? null;
  if (!organizationId) {
    return (
      session.user.name || session.user.email || tSwitcher("personalAccount")
    );
  }
  const name = organizations?.find(
    (organization) => organization.id === organizationId,
  )?.name;
  if (name) return name;
  // A failed list, or one without this workspace yet, still names the crumb.
  return organizations || error ? t("workspace") : null;
}

export function WorkspaceCrumbSkeleton() {
  return (
    <span
      className="bg-muted h-3 w-20 shrink-0 animate-pulse rounded-md"
      aria-hidden
    />
  );
}

/** Rendered only while the popover is open, so each open lists fresh rows. */
function WorkspaceMenu({
  switcher,
  onDone,
  onCreateWorkspace,
}: {
  switcher: WorkspaceSwitcher;
  onDone: () => void;
  onCreateWorkspace: (canCreatePersonal: boolean) => void;
}) {
  const workspaces = useCombinedWorkspaces(switcher);
  return (
    <WorkspaceList
      workspaces={workspaces}
      onChosen={onDone}
      onCreateWorkspace={onCreateWorkspace}
      className="max-h-[22rem]"
    />
  );
}

/**
 * The header variant's first crumb: the workspace, and a switch to another.
 * A switch drops the project scope, since a project has one workspace.
 */
export function WorkspaceCrumb() {
  const t = useTranslations("Components.OrganizationSwitcher");
  const name = useWorkspaceName();
  const { data: session } = useSession();
  const { data: organizations } = authClient.useListOrganizations();
  const organizationId = session?.session.activeOrganizationId;
  const organization = organizations?.find(({ id }) => id === organizationId);
  // Here, not in the content: a switch and its dialogs outlive the popover.
  const switcher = useWorkspaceSwitcher();
  // A created personal workspace activates like a picked one.
  const createWorkspace = useCreateWorkspace(
    useScopedWorkspaceSwitch(switcher),
  );
  const [open, setOpen] = useState(false);

  if (!name) return <WorkspaceCrumbSkeleton />;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-busy={switcher.isPending || undefined}
            data-testid="project-scope-header-workspace"
            className={cn(
              "text-foreground h-auto min-h-8 max-w-40 min-w-6 shrink justify-start overflow-hidden px-1.5 font-medium",
              switcher.isPending && "animate-pulse",
            )}
          >
            <span className="sr-only">{t("switchWorkspace")}</span>
            <HeaderWorkspaceLabel
              name={name}
              email={session?.user.email}
              avatar={
                session && (!organizationId || organization) ? (
                  <HeaderWorkspaceAvatar
                    sessionUser={session.user}
                    organization={
                      organization
                        ? {
                            ...organization,
                            logo: organization.logo ?? null,
                            metadata: organization.metadata ?? null,
                            stripeCustomerId:
                              organization.stripeCustomerId ?? null,
                          }
                        : null
                    }
                    className="size-4 shrink-0"
                    logoSize={12}
                    decorative
                  />
                ) : (
                  <Building2 className="size-4 shrink-0" aria-hidden />
                )
              }
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={t("switchWorkspace")}
          className="w-64 p-0"
        >
          <WorkspaceMenu
            switcher={switcher}
            onDone={() => setOpen(false)}
            onCreateWorkspace={(canCreatePersonal) => {
              setOpen(false);
              createWorkspace.start(canCreatePersonal);
            }}
          />
        </PopoverContent>
      </Popover>
      {createWorkspace.dialogs}
    </>
  );
}
