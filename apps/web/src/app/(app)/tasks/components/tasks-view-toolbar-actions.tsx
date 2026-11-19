"use client";

import { Archive } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { PopoverClose } from "@/components/ui/popover";

import { TasksViewFilters } from "./tasks-view-filters";
import { ViewModeSwitch, type ViewModeSwitchProps } from "./view-mode-switch";

interface TasksViewToolbarActionsProps {
  filters: Omit<ComponentProps<typeof TasksViewFilters>, "display">;
  display: ViewModeSwitchProps;
}

/**
 * The Tasks tab toolbar: the view switcher leads, and the Filters menu and
 * the view options menu take the right edge. Archived Tasks are another
 * way to see Tasks, so their link lives in the view options menu. New task
 * is the sidebar header's action; below md the create FAB covers creation.
 */
export function TasksViewToolbarActions({
  filters,
  display,
}: TasksViewToolbarActionsProps) {
  const t = useTranslations("App.Tasks.Archived");

  return (
    <TasksViewFilters
      {...filters}
      display={
        <ViewModeSwitch {...display}>
          <PopoverClose asChild>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 px-2"
              asChild
            >
              <Link href="/tasks/archived">
                <Archive className="size-4" aria-hidden />
                {t("link")}
              </Link>
            </Button>
          </PopoverClose>
        </ViewModeSwitch>
      }
    />
  );
}
