"use client";

import { ChevronRight, ChevronsUpDown, Layers } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  Suspense,
  useState,
  useSyncExternalStore,
} from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { projectPageSection } from "@/app/components/project-scope/project-scope-href";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { useProjectScopeSwitch } from "@/app/components/project-scope/use-project-scope";
import { useSelectedScopeProject } from "@/app/components/project-scope/use-scope-projects";
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
import { cn } from "@/lib/utils";

import type { ScopeSlots } from "./scope-variants";
import { useScopeVariant } from "./use-scope-variant";

/** Tailwind's `sm`: the desktop trail shows from here, the mobile title below. */
const SM_UP_QUERY = "(min-width: 40rem)";

function subscribeSmUp(onChange: () => void) {
  const query = window.matchMedia(SM_UP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** False on the server and below `sm`, where the desktop trail is hidden. */
function useIsSmUp(): boolean {
  return useSyncExternalStore(
    subscribeSmUp,
    () => window.matchMedia(SM_UP_QUERY).matches,
    () => false,
  );
}

/**
 * The active workspace's name, read-only. Switching workspaces stays with the
 * header's workspace switch. Null while the session or the list loads.
 */
function useWorkspaceName(): string | null {
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

/** The current project, or the workspace view when none is chosen. */
function ScopeLabel({ projectId }: { projectId: string | null }) {
  const t = useTranslations("App.ProjectScope");
  const selectedProject = useSelectedScopeProject(projectId);
  const name = projectId
    ? (selectedProject?.name ?? t("label"))
    : t("workspaceView");

  return (
    <>
      {selectedProject ? (
        <span className="flex shrink-0" aria-hidden>
          <ProjectAvatar
            name={selectedProject.name}
            logo={selectedProject.logo}
            className="size-5"
          />
        </span>
      ) : (
        <Layers className="text-muted-foreground size-4 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 truncate" title={name}>
        {name}
      </span>
      <ChevronsUpDown
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    </>
  );
}

/** The app breadcrumbs' separator, so the whole trail reads as one. */
function Separator() {
  return (
    <ChevronRight
      className="text-muted-foreground size-3.5 shrink-0"
      aria-hidden
    />
  );
}

function WorkspaceCrumbSkeleton() {
  return (
    <span
      className="bg-muted h-3 w-20 shrink-0 animate-pulse rounded-md"
      aria-hidden
    />
  );
}

const WORKSPACE_CRUMB_CLASS =
  "text-muted-foreground max-w-40 min-w-6 truncate font-medium";

/** Links out of the project, or stays text when the workspace view is open. */
function WorkspaceCrumb({ href }: { href: string | null }) {
  const name = useWorkspaceName();
  if (!name) return <WorkspaceCrumbSkeleton />;
  if (!href) {
    return (
      <span className={WORKSPACE_CRUMB_CLASS} title={name}>
        {name}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        WORKSPACE_CRUMB_CLASS,
        "hover:text-foreground focus-visible:ring-ring rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
      )}
      title={name}
    >
      {name}
    </Link>
  );
}

/** Desktop (sm+): `<workspace> › <project ▾>`. `HeaderTrail` adds the page. */
function HeaderBreadcrumbScope() {
  const t = useTranslations("App.ProjectScope");
  const isSmUp = useIsSmUp();
  const scope = useProjectScopeSwitch();
  const [open, setOpen] = useState(false);

  return (
    // -m-1 p-1: room for focus rings inside the clip.
    <div
      className="-m-1 flex min-w-0 shrink items-center gap-1 overflow-hidden p-1 text-sm"
      data-testid="project-scope-header"
    >
      {isSmUp ? (
        <WorkspaceCrumb
          href={scope.projectId ? scope.switchHref(null) : null}
        />
      ) : (
        <WorkspaceCrumbSkeleton />
      )}
      <Separator />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="project-scope-trigger"
            className="text-foreground max-w-64 min-w-16 shrink justify-start gap-1.5 overflow-hidden px-2 font-medium has-[>svg]:px-2"
          >
            <span className="sr-only">{t("switchLabel")}</span>
            <ScopeLabel projectId={scope.projectId} />
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
      {scope.createDialog}
    </div>
  );
}

/**
 * What follows the scope: a project page's section, or the page's own
 * crumbs. Nothing where the scope already names the page.
 */
function useTrail(crumbs: ReactNode): ReactNode {
  const pathname = usePathname();
  const tBreadcrumb = useTranslations("Components.Breadcrumb");
  const tScope = useTranslations("App.ProjectScope");

  if (pathname === "/" || pathname === "/projects") return null;
  const projectSection = projectPageSection(pathname);
  if (projectSection === null) return crumbs;

  const sections: Record<string, string> = {
    "/calendar": tBreadcrumb("calendar"),
    "/social": tScope("social"),
    "/edit": tBreadcrumb("edit"),
    "/design-md/edit": tBreadcrumb("editor"),
  };
  const section = sections[projectSection];
  return section ? (
    <span aria-current="page" className="text-foreground truncate">
      {section}
    </span>
  ) : null;
}

function HeaderTrail({ crumbs }: { crumbs: ReactNode }) {
  const trail = useTrail(crumbs);
  if (!trail) return null;

  return (
    <div
      className="-m-1 flex min-w-0 items-center gap-1 overflow-hidden p-1 text-sm whitespace-nowrap [&_ol]:flex-nowrap [&>nav]:min-w-0 [&>nav]:flex-initial"
      data-testid="project-scope-header-trail"
    >
      <Separator />
      {trail}
    </div>
  );
}

function CrumbsGate({ children }: { children: ReactNode }) {
  return useScopeVariant() === "header" ? (
    <HeaderTrail crumbs={children} />
  ) : (
    children
  );
}

/**
 * The app header's page crumbs. The header variant folds them into its own
 * trail; every other variant renders them unchanged.
 */
export function HeaderVariantCrumbs({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <CrumbsGate>{children}</CrumbsGate>
    </Suspense>
  );
}

function TrailingGate({ children }: { children: ReactNode }) {
  if (useScopeVariant() !== "header") return children;
  // Below sm the scope title needs the room: the workspace switch keeps its
  // avatar, and its name stays for screen readers.
  return (
    <div className="contents max-sm:[&_[data-testid=header-workspace-chrome]_.max-w-24]:sr-only">
      {children}
    </div>
  );
}

/** The header's trailing chrome, narrowed for the header variant on mobile. */
export function HeaderVariantTrailing({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <TrailingGate>{children}</TrailingGate>
    </Suspense>
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
            <ScopeLabel projectId={scope.projectId} />
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
