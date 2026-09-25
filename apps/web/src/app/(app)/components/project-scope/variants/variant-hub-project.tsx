"use client";

import { ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentProps, useState } from "react";
import { scopedHref } from "@/app/components/project-scope/project-scope-href";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import {
  useProjectScope,
  useProjectScopeSwitch,
} from "@/app/components/project-scope/use-project-scope";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import type { ScopeSlotProps } from "./scope-variants";

type SectionKey =
  | "overview"
  | "tasks"
  | "schedules"
  | "calendar"
  | "files"
  | "history"
  | "social";

interface Section {
  key: SectionKey;
  href: string;
}

function projectSections(projectId: string, calendarBeta: boolean): Section[] {
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  const sections: Section[] = [
    { key: "overview", href: projectPath },
    { key: "tasks", href: scopedHref("/tasks", projectId) },
    { key: "schedules", href: scopedHref(TASK_SCHEDULES_PATH, projectId) },
    // The project page, not `/calendar?projectId=`: the hub nav lives there.
    { key: "calendar", href: `${projectPath}/calendar` },
    { key: "files", href: scopedHref("/drive", projectId) },
    { key: "history", href: scopedHref("/history", projectId) },
    { key: "social", href: `${projectPath}/social` },
  ];
  // Both pages turn away readers without Calendar beta.
  return calendarBeta
    ? sections
    : sections.filter(({ key }) => key !== "calendar" && key !== "social");
}

/**
 * SOK-1202 "hub": the project header carries the switcher and the project's
 * sections. The workspace sections open the scoped workspace page.
 */
export function HubProjectHeader({ calendarBeta = false }: ScopeSlotProps) {
  const { projectId } = useProjectScope();
  if (!projectId) return null;

  return (
    <div className="space-y-2">
      <HubProjectSwitcher />
      <HubSectionNav projectId={projectId} calendarBeta={calendarBeta} />
    </div>
  );
}

function HubProjectSwitcher() {
  const t = useTranslations("App.ProjectScope");
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { projectId, select, openCreate, createDialog } =
    useProjectScopeSwitch();

  const menu = (
    <ProjectScopeMenu
      selectedProjectId={projectId}
      onSelect={select}
      onCreate={openCreate}
      onDone={() => setOpen(false)}
    />
  );

  const trigger = <SwitcherTrigger label={t("switchLabel")} />;

  return (
    <>
      {isMobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <SheetHeader className="pb-2">
              <SheetTitle>{t("switchLabel")}</SheetTitle>
              <SheetDescription className="sr-only">
                {t("searchPlaceholder")}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 px-2">{menu}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            {menu}
          </PopoverContent>
        </Popover>
      )}
      {createDialog}
    </>
  );
}

interface SwitcherTriggerProps extends ComponentProps<typeof Button> {
  label: string;
}

/**
 * Forwards the Radix trigger props (aria-expanded, aria-haspopup, onClick).
 * No project name: the page title right below already shows it.
 */
function SwitcherTrigger({ label, className, ...props }: SwitcherTriggerProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("-ml-2 max-w-full min-w-0 justify-start", className)}
      {...props}
    >
      <span className="text-muted-foreground min-w-0 truncate">{label}</span>
      <ChevronsUpDown className="text-muted-foreground size-4" aria-hidden />
    </Button>
  );
}

function HubSectionNav({
  projectId,
  calendarBeta,
}: {
  projectId: string;
  calendarBeta: boolean;
}) {
  const t = useTranslations("App.ProjectScope");
  const pathname = usePathname();
  const sections = projectSections(projectId, calendarBeta);

  return (
    <nav
      aria-label={t("sections")}
      className="before:bg-border relative before:absolute before:inset-x-0 before:bottom-0 before:h-px"
    >
      <ul className="relative flex gap-4 overflow-x-auto text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section) => {
          const active = pathname === section.href;
          return (
            <li key={section.key} className="shrink-0">
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring block rounded-t-sm border-b-2 px-1 py-2 whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset",
                  active
                    ? "border-foreground text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {t(section.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
