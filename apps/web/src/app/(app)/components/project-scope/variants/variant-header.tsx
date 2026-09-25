"use client";

import { ChevronsUpDown, Layers } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { useProjectScopeSwitch } from "@/app/components/project-scope/use-project-scope";
import { useScopeProjects } from "@/app/components/project-scope/use-scope-projects";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { authClient, useSession } from "@/lib/auth/auth.client";

import type { ScopeSlots } from "./scope-variants";

/**
 * The active workspace's name, read-only. Switching workspaces stays with the
 * header's workspace switch. Null while the session or the list loads.
 */
function useWorkspaceName(): string | null {
  const t = useTranslations("Components.OrganizationSwitcher");
  const { data: session } = useSession();
  const { data: organizations } = authClient.useListOrganizations();
  if (!session) return null;
  const organizationId = session.session.activeOrganizationId ?? null;
  if (!organizationId) {
    return session.user.name || session.user.email || t("personalAccount");
  }
  return (
    organizations?.find((organization) => organization.id === organizationId)
      ?.name ?? null
  );
}

/** The current project, or the workspace view when none is chosen. */
function ScopeLabel({
  projectId,
  nameClassName,
}: {
  projectId: string | null;
  nameClassName: string;
}) {
  const t = useTranslations("App.ProjectScope");
  const { selectedProject } = useScopeProjects({
    search: "",
    selectedProjectId: projectId,
  });
  const name = projectId ? (selectedProject?.name ?? null) : t("workspaceView");

  return (
    <>
      {selectedProject ? (
        <ProjectAvatar
          name={selectedProject.name}
          logo={selectedProject.logo}
          className="size-5 shrink-0"
        />
      ) : (
        <Layers className="text-muted-foreground size-4 shrink-0" aria-hidden />
      )}
      {name ? (
        <span className={nameClassName} title={name}>
          {name}
        </span>
      ) : (
        <span
          className="bg-muted h-3 w-16 shrink animate-pulse rounded-md"
          aria-hidden
        />
      )}
      <ChevronsUpDown
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    </>
  );
}

function Slash() {
  return (
    <span className="text-muted-foreground shrink-0 select-none" aria-hidden>
      /
    </span>
  );
}

/** Desktop (sm+): `<workspace> / <project ▾> /`, then the page breadcrumbs. */
function HeaderBreadcrumbScope() {
  const t = useTranslations("App.ProjectScope");
  const workspaceName = useWorkspaceName();
  const scope = useProjectScopeSwitch();
  const [open, setOpen] = useState(false);

  return (
    <div
      className="flex min-w-0 shrink items-center gap-1 text-sm"
      data-testid="project-scope-header"
    >
      {workspaceName ? (
        <Link
          href={scope.switchHref(null)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring max-w-40 truncate rounded-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
          title={workspaceName}
        >
          {workspaceName}
        </Link>
      ) : (
        <span
          className="bg-muted h-3 w-20 shrink-0 animate-pulse rounded-md"
          aria-hidden
        />
      )}
      <Slash />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="project-scope-trigger"
            className="text-foreground min-w-0 max-w-64 justify-start gap-1.5 px-2 font-medium has-[>svg]:px-2"
          >
            <span className="sr-only">{t("switchLabel")}</span>
            <ScopeLabel
              projectId={scope.projectId}
              nameClassName="min-w-0 truncate"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <ProjectScopeMenu
            selectedProjectId={scope.projectId}
            onSelect={scope.select}
            onCreate={scope.openCreate}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <Slash />
      {scope.createDialog}
    </div>
  );
}

/** Mobile (below sm): the header title becomes the switcher. */
function HeaderMobileScope() {
  const t = useTranslations("App.ProjectScope");
  const pathname = usePathname();
  const scope = useProjectScopeSwitch();
  const [open, setOpen] = useState(false);

  // A chat room's toolbar owns this space below md.
  if (isChatRoomPathname(pathname)) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="project-scope-trigger-mobile"
            className="text-foreground min-w-0 flex-1 justify-start gap-1.5 overflow-hidden px-2 font-medium has-[>svg]:px-2 sm:hidden"
          >
            <span className="sr-only">{t("switchLabel")}</span>
            <ScopeLabel
              projectId={scope.projectId}
              nameClassName="min-w-0 truncate"
            />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="pb-2">
            <SheetTitle>{t("switchLabel")}</SheetTitle>
          </SheetHeader>
          <ProjectScopeMenu
            selectedProjectId={scope.projectId}
            onSelect={scope.select}
            onCreate={scope.openCreate}
            onDone={() => setOpen(false)}
            className="bg-transparent [&_[data-slot=command-list]]:max-h-[60dvh]"
          />
        </SheetContent>
      </Sheet>
      {scope.createDialog}
    </>
  );
}

/** SOK-1202 variant "header": a breadcrumb-style scope in the app header. */
export const headerSlots: ScopeSlots = {
  "header-center": HeaderBreadcrumbScope,
  "header-mobile": HeaderMobileScope,
};
