"use client";

import { Check, Pin, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

import { type ScopeProject, useScopeProjects } from "./use-scope-projects";

const CREATE_VALUE = "__create_project__";

/**
 * The trigger of the popover, sheet or dialog that holds the menu. Radix links
 * the two through `aria-controls`. The menu unmounts on Create, so the create
 * dialog cannot return focus to it.
 */
function openerOf(menu: Element | null): HTMLElement | null {
  const host = menu?.closest('[role="dialog"][id]');
  if (!host) return null;
  const opener = document.querySelector(
    `[aria-controls="${CSS.escape(host.id)}"]`,
  );
  return opener instanceof HTMLElement ? opener : null;
}

interface ProjectScopeMenuProps {
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
  /** Gets the control that opened the menu, to take focus back on cancel. */
  onCreate: (opener: HTMLElement | null) => void;
  /** Closes whatever holds the menu. Runs after every choice. */
  onDone?: () => void;
  className?: string;
}

/**
 * The one project list every switcher shows: search, one list of projects
 * (Pinned projects first, each with a pin unless the current project's check
 * takes its place, then recently visited, then the rest), then Create. Search
 * narrows that same list and asks Core, so the list filters itself off. All
 * projects is not a row: the trigger's × returns to it.
 */
export function ProjectScopeMenu({
  selectedProjectId,
  onSelect,
  onCreate,
  onDone,
  className,
}: ProjectScopeMenuProps) {
  const t = useTranslations("App.ProjectScope");
  const [search, setSearch] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const projects = useScopeProjects({ search, selectedProjectId });

  function choose(projectId: string) {
    onSelect(projectId);
    onDone?.();
  }

  function row(project: ScopeProject) {
    const pinned = projects.pinnedIds.has(project.id);
    return (
      <CommandItem
        key={project.id}
        value={project.id}
        data-testid={`project-scope-item-${project.id}`}
        className={cn(
          "min-h-11 gap-3 px-2.5 py-2 md:min-h-9 md:py-1.5",
          project.id === selectedProjectId && "font-medium",
        )}
        onSelect={() => choose(project.id)}
      >
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center"
        >
          <ProjectAvatar
            name={project.name}
            logo={project.logo}
            className="size-6 rounded-md [&_[data-slot=avatar-fallback]]:rounded-md"
          />
        </span>
        <span className="min-w-0 flex-1 break-words leading-normal">
          {project.name}
        </span>
        {/* One trailing icon per row, so neither mark moves off the edge. */}
        {project.id === selectedProjectId ? (
          <CurrentMark />
        ) : pinned ? (
          <Pin className="text-muted-foreground size-3.5 shrink-0" />
        ) : null}
        {pinned ? <span className="sr-only">{t("pinned")}</span> : null}
      </CommandItem>
    );
  }

  const rows = projects.rows;

  // Not `CommandEmpty` for "empty": Create is always mounted, so
  // cmdk never counts the list as empty. The rows of a search Core has not
  // answered yet are the last search's, so they cannot mean "none found".
  const busy = projects.isPending || projects.isSearchPending;
  const statusText = projects.isError
    ? t("error")
    : projects.isPending
      ? t("loading")
      : projects.isSearchPending
        ? t("searching")
        : projects.isSearching && rows.length === 0
          ? t("empty")
          : null;

  return (
    <Command
      ref={menuRef}
      label={t("searchPlaceholder")}
      shouldFilter={false}
      className={cn(
        "app-scrollbar h-auto min-h-0 overflow-y-auto overscroll-contain [&_[data-slot=command-input-wrapper]]:shrink-0 [&_[cmdk-group]]:p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[data-slot=command-input-wrapper]]:has-focus-visible:border-ring",
        className,
      )}
    >
      <CommandInput
        autoFocus
        placeholder={t("searchPlaceholder")}
        value={search}
        onValueChange={setSearch}
      />
      {/* Outside the listbox, which may hold only options, and always
          mounted, so a screen reader hears each change. */}
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center justify-between gap-2 px-3",
          statusText && "py-2",
        )}
      >
        <p
          role="status"
          className="text-muted-foreground min-w-0 break-words text-sm"
        >
          {statusText}
        </p>
        {projects.isError ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto min-h-11 max-w-full whitespace-normal py-2 md:min-h-8"
            onKeyDown={(event) => event.stopPropagation()}
            onClick={() => {
              projects.refetch();
              menuRef.current?.querySelector("input")?.focus();
            }}
          >
            {t("retry")}
          </Button>
        ) : projects.isSearching && rows.length === 0 && !busy ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto min-h-11 max-w-full whitespace-normal py-2 md:min-h-8"
            onKeyDown={(event) => event.stopPropagation()}
            onClick={() => {
              setSearch("");
              menuRef.current?.querySelector("input")?.focus();
            }}
          >
            {t("clearSearch")}
          </Button>
        ) : null}
      </div>
      <CommandList
        label={t("all")}
        aria-busy={busy || undefined}
        className={cn(
          "flex min-h-0 max-h-96 flex-col overflow-visible [&_[cmdk-list-sizer]]:flex [&_[cmdk-list-sizer]]:min-h-0 [&_[cmdk-list-sizer]]:flex-col",
          statusText && "shrink-0",
        )}
      >
        <div
          className="app-scrollbar min-h-0 overflow-y-auto overscroll-contain scroll-py-1.5"
          role="presentation"
        >
          {rows.length > 0 ? (
            <CommandGroup>{rows.map(row)}</CommandGroup>
          ) : null}
        </div>
        <CommandGroup forceMount className="shrink-0 border-t">
          <CommandItem
            forceMount
            className="min-h-11 gap-3 px-2.5 py-2 md:min-h-9 md:py-1.5"
            value={CREATE_VALUE}
            data-testid="project-scope-create"
            onSelect={() => {
              const opener = openerOf(menuRef.current);
              onDone?.();
              onCreate(opener);
            }}
          >
            <span
              className="flex size-6 shrink-0 items-center justify-center"
              aria-hidden
            >
              <Plus className="size-4" />
            </span>
            <span className="min-w-0 flex-1 break-words">{t("create")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** The check on the current choice, with words for assistive tech. */
function CurrentMark() {
  const t = useTranslations("App.ProjectScope");
  return (
    <>
      <Check className="size-4 shrink-0" />
      <span className="sr-only">{t("current")}</span>
    </>
  );
}
