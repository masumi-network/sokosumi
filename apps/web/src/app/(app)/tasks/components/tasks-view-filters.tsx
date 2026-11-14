"use client";

import { TaskStatus, TaskVisibility } from "@sokosumi/core-client";
import {
  Building2,
  CircleDashed,
  Eye,
  Hourglass,
  Sparkles,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import {
  KANBAN_COLUMNS,
  type KanbanColumnId,
} from "@/app/tasks/types/task-board";
import { COLUMN_TASK_STATUSES } from "@/app/tasks/utils/task-column";
import {
  buildTasksFiltersSearchParams,
  getDefaultTasksScope,
  getTasksFiltersFromSearchParams,
  hasActiveTasksFilters,
  type ProjectFilterOption,
  STUCK_AFTER_DAYS,
  type TasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChipRemoveButton } from "@/components/ui/chip-remove-button";
import type { CoworkerOption } from "@/lib/types/coworker";

/**
 * Focuses the first visible toolbar button outside the chip list. A removed
 * chip or a cleared empty state unmounts the focused button, which would
 * otherwise drop keyboard focus to the page.
 */
export function focusToolbarControl(toolbar: Element | null | undefined) {
  Array.from(toolbar?.querySelectorAll("button") ?? [])
    .find((button) => !button.closest("ul") && button.offsetParent !== null)
    ?.focus();
}

interface TasksViewFiltersProps {
  activeOrganizationId: string | null;
  /** The viewer, for the My tasks toggle; hidden when they are not an option. */
  userId?: string | null;
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  labels: {
    title: string;
    searchPlaceholder: string;
    emptyResults: string;
    all: string;
    scopeLabel: string;
    scopeOwned: string;
    assignedToMe: string;
    scopeWorkspace: string;
    coworkerLabel: string;
    statusLabel: string;
    visibilityLabel: string;
    visibilityPrivate: string;
    statusOptions: Record<TaskStatus, string>;
    /** Board column names: the status filter groups its statuses under them. */
    columns: Record<KanbanColumnId, string>;
  };
}

export function TasksViewFilters({
  activeOrganizationId,
  userId,
  coworkerOptions,
  projectOptions,
  labels,
}: TasksViewFiltersProps) {
  const t = useTranslations("App.Tasks.Filters");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () =>
      getTasksFiltersFromSearchParams(
        searchParams,
        activeOrganizationId,
        coworkerOptions,
        projectOptions,
      ),
    [activeOrganizationId, coworkerOptions, projectOptions, searchParams],
  );

  const showActiveIndicator = useMemo(
    () => hasActiveTasksFilters(filters, activeOrganizationId),
    [activeOrganizationId, filters],
  );

  const handleFilterChange = useCallback(
    (patch: Partial<TasksFilters>) => {
      const paramsForMerge = new URLSearchParams(
        typeof window !== "undefined"
          ? window.location.search
          : searchParams.toString(),
      );
      const current = getTasksFiltersFromSearchParams(
        paramsForMerge,
        activeOrganizationId,
        coworkerOptions,
        projectOptions,
      );
      const nextFilters: TasksFilters = { ...current, ...patch };
      const nextSearchParams = buildTasksFiltersSearchParams(
        paramsForMerge,
        nextFilters,
        activeOrganizationId,
      );
      const nextQuery = nextSearchParams.toString();

      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    },
    [
      activeOrganizationId,
      coworkerOptions,
      pathname,
      projectOptions,
      router,
      searchParams,
    ],
  );

  const sections = useMemo<FilterDropdownMenuSection[]>(() => {
    const nextSections: FilterDropdownMenuSection[] = [];

    if (activeOrganizationId !== null) {
      nextSections.push({
        id: "scope",
        label: labels.scopeLabel,
        icon: Building2,
        value: filters.scope,
        onChange: (scope) =>
          handleFilterChange({
            scope: (scope as TasksFilters["scope"]) ?? "workspace",
          }),
        options: [
          {
            value: "workspace",
            label: labels.scopeWorkspace,
          },
          {
            value: "owned",
            label: labels.scopeOwned,
          },
        ],
      });

      nextSections.push({
        id: "visibility",
        label: labels.visibilityLabel,
        icon: Eye,
        value: filters.visibility,
        allLabel: labels.all,
        onChange: (visibility) =>
          handleFilterChange({
            visibility:
              visibility === TaskVisibility.PRIVATE
                ? TaskVisibility.PRIVATE
                : null,
          }),
        options: [
          {
            value: TaskVisibility.PRIVATE,
            label: labels.visibilityPrivate,
          },
        ],
      });
    }

    nextSections.push({
      id: "coworker",
      label: labels.coworkerLabel,
      icon: Sparkles,
      value:
        filters.assigneeSokoBotId ??
        filters.assigneeUserId ??
        filters.assigneeId,
      allLabel: labels.all,
      onChange: (selectedId) => {
        const selected = coworkerOptions.find(
          (option) => option.id === selectedId,
        );
        if (selected?.kind === "sokoBot") {
          handleFilterChange({
            assigneeId: null,
            assigneeSokoBotId: selectedId,
            assigneeUserId: null,
          });
          return;
        }
        if (selected?.kind === "user") {
          handleFilterChange({
            assigneeId: null,
            assigneeSokoBotId: null,
            assigneeUserId: selectedId,
          });
          return;
        }
        handleFilterChange({
          assigneeId: selectedId,
          assigneeSokoBotId: null,
          assigneeUserId: null,
        });
      },
      options: coworkerOptions.map((coworker) => ({
        value: coworker.id,
        label: coworker.name,
        avatarLabel: coworker.name,
        image: coworker.image,
        searchKeywords: [coworker.slug],
      })),
    });

    nextSections.push({
      id: "status",
      label: labels.statusLabel,
      icon: CircleDashed,
      value: filters.status,
      allLabel: labels.all,
      onChange: (status) =>
        handleFilterChange({
          status: (status as TaskStatus | null) ?? null,
        }),
      options: KANBAN_COLUMNS.flatMap((column) =>
        COLUMN_TASK_STATUSES[column.id].map((status) => ({
          value: status,
          label: labels.statusOptions[status],
          group: labels.columns[column.id],
        })),
      ),
    });

    return nextSections;
  }, [
    activeOrganizationId,
    coworkerOptions,
    filters,
    handleFilterChange,
    labels.all,
    labels.columns,
    labels.coworkerLabel,
    labels.scopeLabel,
    labels.scopeOwned,
    labels.scopeWorkspace,
    labels.statusLabel,
    labels.statusOptions,
    labels.visibilityLabel,
    labels.visibilityPrivate,
  ]);

  const me = coworkerOptions.find(
    (option) => option.kind === "user" && option.id === userId,
  );
  const showingMine = !!me && filters.assigneeUserId === userId;

  // One removable chip per filter the Filters menu set; the project switcher owns projectId.
  const assigneeId =
    filters.assigneeSokoBotId ?? filters.assigneeUserId ?? filters.assigneeId;
  const chips = [
    filters.scope !== getDefaultTasksScope(activeOrganizationId) && {
      id: "scope",
      label: labels.scopeLabel,
      value:
        filters.scope === "owned" ? labels.scopeOwned : labels.scopeWorkspace,
      clear: { scope: getDefaultTasksScope(activeOrganizationId) },
    },
    filters.visibility === TaskVisibility.PRIVATE && {
      id: "visibility",
      label: labels.visibilityLabel,
      value: labels.visibilityPrivate,
      clear: { visibility: null },
    },
    assigneeId && {
      id: "coworker",
      label: labels.coworkerLabel,
      value:
        coworkerOptions.find((option) => option.id === assigneeId)?.name ??
        assigneeId,
      clear: {
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
      },
    },
    filters.status && {
      id: "status",
      label: labels.statusLabel,
      value: labels.statusOptions[filters.status],
      clear: { status: null },
    },
  ].filter((chip) => !!chip);

  return (
    <>
      {chips.length > 0 ? (
        <ul aria-label={t("activeFilters")} className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const name = t("chip", { label: chip.label, value: chip.value });
            return (
              <li
                key={chip.id}
                className="bg-muted text-foreground inline-flex min-w-0 items-center rounded-full ps-3 text-sm"
              >
                <span className="truncate">{name}</span>
                <ChipRemoveButton
                  aria-label={t("removeFilter", { filter: name })}
                  onClick={(event) => {
                    const toolbar =
                      event.currentTarget.closest("ul")?.parentElement;
                    handleFilterChange(chip.clear);
                    focusToolbarControl(toolbar);
                  }}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      {me ? (
        <Button
          variant={showingMine ? "secondary" : "outline"}
          size="sm"
          aria-pressed={showingMine}
          className="ps-1.5"
          onClick={() =>
            handleFilterChange({
              assigneeId: null,
              assigneeSokoBotId: null,
              assigneeUserId: showingMine ? null : (userId ?? null),
            })
          }
        >
          <Avatar aria-hidden className="size-5 shrink-0">
            {me.image ? <AvatarImage src={me.image} alt="" /> : null}
            <AvatarFallback className="bg-muted text-2xs font-medium">
              {me.name.trim().charAt(0).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          {labels.assignedToMe}
        </Button>
      ) : null}
      <Button
        variant={filters.stuck ? "secondary" : "outline"}
        size="sm"
        aria-pressed={filters.stuck}
        title={t("stuckHint", { days: STUCK_AFTER_DAYS })}
        onClick={() => handleFilterChange({ stuck: !filters.stuck })}
      >
        <Hourglass aria-hidden />
        {t("stuck", { days: STUCK_AFTER_DAYS })}
      </Button>
      <FilterDropdownMenu
        buttonLabel={labels.title}
        searchPlaceholder={labels.searchPlaceholder}
        emptyResultsLabel={labels.emptyResults}
        sections={sections}
        showActiveIndicator={showActiveIndicator}
      />
    </>
  );
}
