"use client";

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
 * Social accounts, on the all-projects view.
 *
 * Accounts are connected per project, so there is nothing to connect for the
 * workspace as a whole. Rather than hide the section, it says so and offers
 * the sidebar switcher's own list, so choosing here and choosing in the
 * sidebar are the same act.
 */
export function SocialAccountsProjectPrompt({ notice }: { notice?: string }) {
  const t = useTranslations("App.Social");
  const { projectId, select } = useProjectScopeSwitch();
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-labelledby="social-accounts-heading"
      className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      data-testid="social-no-project"
    >
      <div className="space-y-1">
        <h2 id="social-accounts-heading" className="text-base font-semibold">
          {t("accountsNeedProject.title")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {notice ?? t("accountsNeedProject.body")}
        </p>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            className="shrink-0"
            size="sm"
            type="button"
            variant="outline"
          >
            {t("pickAction")}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
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
    </section>
  );
}
