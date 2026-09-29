"use client";

import { FolderKanban } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { openScopeCreate } from "@/app/components/project-scope/sidebar-project-scope-state";
import { useProjectScopeSwitch } from "@/app/components/project-scope/use-project-scope";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * What the studio shows before it knows which project it is working in.
 *
 * The list is the sidebar switcher's own list — same component, same search,
 * same Create and Manage rows — so choosing here and choosing in the sidebar
 * are the same act, and `select` writes the scope back into the URL the way
 * every other scoped page does. Building a second project list just for this
 * page would let the two drift.
 */
export function StudioProjectPicker({ notice }: { notice?: string }) {
  const t = useTranslations("App.Studio");
  const { projectId, select } = useProjectScopeSwitch();
  const [open, setOpen] = useState(false);

  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center py-10 text-center"
      data-testid="studio-no-project"
    >
      <span
        aria-hidden
        className="bg-background border-border text-muted-foreground flex size-10 items-center justify-center rounded-lg border"
      >
        <FolderKanban className="size-5" />
      </span>
      <h2 className="mt-4 text-base font-semibold tracking-tight">
        {t("pickTitle")}
      </h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {notice ?? t("pickBody")}
      </p>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button className="mt-5" type="button">
            {t("pickAction")}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          side="bottom"
          className="flex max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 motion-reduce:animate-none"
        >
          <ProjectScopeMenu
            selectedProjectId={projectId}
            onSelect={select}
            onCreate={openScopeCreate}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
