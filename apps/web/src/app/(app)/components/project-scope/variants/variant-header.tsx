"use client";

import { ChevronsUpDown, Layers } from "lucide-react";
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
import { BreadcrumbLandmarkContext } from "@/components/breadcrumb-navigation/breadcrumb-navigation.client";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
import { cn } from "@/lib/utils";

import type { ScopeSlots, ScopeVariantId } from "./scope-variants";
import { useScopeVariant } from "./use-scope-variant";
import {
  WorkspaceCrumb,
  WorkspaceCrumbSkeleton,
} from "./variant-header-workspace";

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

/**
 * The crumb after the scope: a project section's name, the page's own server
 * crumbs, or none. On the project list and a project's own page, the scope is
 * the current page.
 */
type PageCrumb =
  | { kind: "section"; label: string }
  | { kind: "crumbs" }
  | { kind: "scope" }
  | null;

function usePageCrumb(): PageCrumb {
  const pathname = usePathname();
  const tBreadcrumb = useTranslations("Components.Breadcrumb");
  const tScope = useTranslations("App.ProjectScope");

  if (pathname === "/") return null;
  if (pathname === "/projects") return { kind: "scope" };
  const projectSection = projectPageSection(pathname);
  if (projectSection === null) return { kind: "crumbs" };

  const sections: Record<string, string> = {
    "/calendar": tBreadcrumb("calendar"),
    "/social": tScope("social"),
    "/edit": tBreadcrumb("edit"),
    "/design-md/edit": tBreadcrumb("editor"),
  };
  const label = sections[projectSection];
  return label ? { kind: "section", label } : { kind: "scope" };
}

/**
 * One line. The current page's crumb gives way first, down to a few
 * characters and an ellipsis. Then the crumbs before it shrink in proportion,
 * each down to its own floor.
 */
const HEADER_BREADCRUMB_CLASS =
  "-m-1 flex min-w-0 items-center gap-1.5 overflow-hidden p-1 text-sm whitespace-nowrap sm:gap-2.5 [&_ol]:min-w-0 [&_ol]:flex-nowrap [&_[data-slot=breadcrumb-page]]:truncate";

/** Shrinks far ahead of the other crumbs, which keep the default of 1. */
const PAGE_CRUMB_SHRINK_CLASS = "shrink-[100]";

/**
 * The server's current crumb gives way first. Its middle crumbs truncate
 * too, so they cannot push the current crumb out of the clip.
 */
const SERVER_CRUMBS_CLASS =
  "[&_li:last-child]:min-w-12 [&_li:last-child]:shrink-[100] [&_li:has(>[data-slot=breadcrumb-link])]:min-w-6 [&_[data-slot=breadcrumb-link]]:truncate";

/** Desktop (sm+): `<workspace> › <project ▾> › <page>`, one breadcrumb. */
function HeaderBreadcrumb({ crumbs }: { crumbs: ReactNode }) {
  const t = useTranslations("App.ProjectScope");
  const isSmUp = useIsSmUp();
  const scope = useProjectScopeSwitch();
  const pageCrumb = usePageCrumb();
  const [open, setOpen] = useState(false);
  const hasServerCrumbs = pageCrumb?.kind === "crumbs";

  return (
    // -m-1 p-1: room for focus rings inside each clip. The list clips too,
    // so a squeezed scope never paints over the server crumbs.
    <Breadcrumb
      className={cn(
        HEADER_BREADCRUMB_CLASS,
        hasServerCrumbs && SERVER_CRUMBS_CLASS,
      )}
      data-testid="project-scope-header"
    >
      <BreadcrumbList className="-m-1 overflow-hidden p-1">
        <BreadcrumbItem className="min-w-6">
          {isSmUp ? <WorkspaceCrumb /> : <WorkspaceCrumbSkeleton />}
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-16">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-current={pageCrumb?.kind === "scope" ? "page" : undefined}
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
        </BreadcrumbItem>
        {pageCrumb?.kind === "section" || hasServerCrumbs ? (
          <BreadcrumbSeparator />
        ) : null}
        {pageCrumb?.kind === "section" ? (
          <BreadcrumbItem className={cn("min-w-12", PAGE_CRUMB_SHRINK_CLASS)}>
            <BreadcrumbPage>{pageCrumb.label}</BreadcrumbPage>
          </BreadcrumbItem>
        ) : null}
        {/* The server crumbs drop their own landmark, join this list and
            keep the scope in their links. */}
        {hasServerCrumbs ? (
          <BreadcrumbLandmarkContext
            value={{ ownsLandmark: false, mapHref: scope.hrefFor }}
          >
            {crumbs}
          </BreadcrumbLandmarkContext>
        ) : null}
      </BreadcrumbList>
      {scope.createDialog}
    </Breadcrumb>
  );
}

function CrumbsGate({ children }: { children: ReactNode }) {
  return useScopeVariant() === "header" ? (
    <HeaderBreadcrumb crumbs={children} />
  ) : (
    children
  );
}

/**
 * The app header's page crumbs. The header variant folds them into its
 * breadcrumb after the scope; every other variant renders them unchanged.
 */
export function HeaderVariantCrumbs({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <CrumbsGate>{children}</CrumbsGate>
    </Suspense>
  );
}

/**
 * Variants with a `header-mobile` slot: a text pill, or hub's avatar and
 * clear button. Hub's chip is small, but a phone header still has no room
 * for it beside the workspace name.
 */
const NARROW_TRAILING_VARIANTS: ReadonlySet<ScopeVariantId> = new Set([
  "header",
  "command",
  "combined",
  "sidebar",
  "hub",
]);

/** Below sm the workspace switch keeps its avatar; its name goes sr-only. */
const NARROW_TRAILING_CLASS =
  "contents max-sm:[&_[data-testid=header-workspace-chrome]_[data-slot=header-workspace-name]]:sr-only";

/**
 * From md up, combined's own header control switches workspaces, so today's
 * switch and its loading placeholder give way. The tools after them stay.
 */
const COMBINED_TRAILING_CLASS =
  "md:[&_[data-testid=header-workspace-chrome]]:hidden md:[&_[data-testid=header-workspace-chrome-skeleton]]:hidden";

function TrailingGate({ children }: { children: ReactNode }) {
  const variant = useScopeVariant();
  if (!NARROW_TRAILING_VARIANTS.has(variant)) return children;
  // Below sm the scope control needs the room, or it paints over the
  // workspace name. The name stays for screen readers.
  return (
    <div
      className={cn(
        NARROW_TRAILING_CLASS,
        variant === "combined" && COMBINED_TRAILING_CLASS,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The header's trailing chrome, narrowed on mobile for every variant with a
 * `header-mobile` slot.
 */
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

/**
 * SOK-1202 variant "header": a breadcrumb-style scope in the app header. The
 * desktop scope rides in `HeaderVariantCrumbs`, so one breadcrumb holds it.
 */
export const headerSlots: ScopeSlots = {
  "header-mobile": HeaderMobileScope,
};
