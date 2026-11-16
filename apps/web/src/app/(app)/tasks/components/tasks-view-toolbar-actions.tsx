"use client";

import { Archive } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

import { TasksViewFilters } from "./tasks-view-filters";
import { ViewModeSwitch, type ViewModeSwitchProps } from "./view-mode-switch";

interface TasksViewToolbarActionsProps {
  filters: ComponentProps<typeof TasksViewFilters>;
  display: ViewModeSwitchProps;
}

/**
 * Right side of the Tasks tab toolbar: filters, display and the way to
 * archived Tasks. New task is the
 * sidebar header's action; below md the create FAB covers creation.
 */
export function TasksViewToolbarActions({
  filters,
  display,
}: TasksViewToolbarActionsProps) {
  const t = useTranslations("App.Tasks.Archived");
  return (
    <>
      <TasksViewFilters {...filters} />
      <ViewModeSwitch {...display} />
      <Button variant="outline" size="sm" className="gap-2" asChild>
        <Link href="/tasks/archived" aria-label={t("title")}>
          <Archive className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t("link")}</span>
        </Link>
      </Button>
    </>
  );
}
