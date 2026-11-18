"use client";

import { TaskStatus, TaskTagId, TaskVisibility } from "@sokosumi/core-client";
import {
  Building2,
  CircleDashed,
  Eye,
  Hand,
  Hourglass,
  Tag,
  Users,
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
import { cn } from "@/lib/utils";
import { useWorkspaceTags } from "@/queries/workspace-tags";
import { TaskTagDot } from "./task-tag-colors";

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
  const tTags = useTranslations("App.Tasks.Tags");
  const workspaceTags = useWorkspaceTags(activeOrganizationId, {
    includeArchived: true,
  });
  const tagOptions = useMemo(
    () => [
      ...Array.from(workspaceTags.data ?? [])
        .sort((a, b) => Number(a.archived) - Number(b.archived))
        .map((tag) => ({
          mark: <TaskTagDot {...tag} />,
          value: tag.id,
          label: tag.displayName,
          group: tag.archived ? t("archivedTags") : t("workspaceTags"),
        })),
      ...Object.values(TaskTagId).map((id) => ({
        mark: <TaskTagDot id={id} />,
        value: id,
        label: tTags(`vocabulary.${id}`),
        group: t("topicTags"),
      })),
    ],
    [t, tTags, workspaceTags.data],
  );
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
      icon: Users,
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

    nextSections.push({
      id: "tag",
      label: tTags("label"),
      icon: Tag,
      value: filters.tag ?? null,
      allLabel: labels.all,
      onChange: (tag) => handleFilterChange({ tag: tag ?? undefined }),
      options: tagOptions,
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
    tTags,
    tagOptions,
  ]);

  const me = coworkerOptions.find(
    (option) => option.kind === "user" && option.id === userId,
  );
  const showingMine = !!me && filters.assigneeUserId === userId;

  // One removable chip per filter the Filters menu set; the project switcher owns projectId.
  const assigneeId =
    filters.assigneeSokoBotId ?? filters.assigneeUserId ?? filters.assigneeId;
  const chips = [
    // Needs me reads the reader's own Tasks whatever the scope says, so the
    // scope chip would name a scope that is not the one shown.
    !filters.needsMe &&
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
    filters.tag && {
      id: "tag",
      label: tTags("label"),
      value:
        tagOptions.find((option) => option.value === filters.tag)?.label ??
        t("workspaceTags"),
      clear: { tag: undefined },
    },
    filters.status && {
      id: "status",
      label: labels.statusLabel,
      value: labels.statusOptions[filters.status],
      clear: { status: null },
    },
  ].filter((chip) => !!chip);

  return (
    // Anchored to the board's left edge: the menu first, then the two quick
    // filters, then what is active. Chips wrap under them, never over Display.
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <FilterDropdownMenu
        buttonLabel={labels.title}
        searchPlaceholder={labels.searchPlaceholder}
        emptyResultsLabel={labels.emptyResults}
        sections={sections}
        showActiveIndicator={showActiveIndicator}
        align="start"
      />
      {me ? (
        <Button
          variant={showingMine ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={showingMine}
          // On is a fill and an outline: the fill alone is too close to the
          // page to read as pressed.
          className={cn("ps-1.5", showingMine && "border-control-border")}
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
        variant={filters.stuck ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={filters.stuck}
        title={t("stuckHint", { days: STUCK_AFTER_DAYS })}
        className={cn("hit-area", filters.stuck && "border-control-border")}
        onClick={() => handleFilterChange({ stuck: !filters.stuck })}
      >
        <Hourglass aria-hidden />
        {/* Icon only on a phone, so the toolbar stays one row. */}
        <span className="max-sm:sr-only">
          {t("stuck", { days: STUCK_AFTER_DAYS })}
        </span>
      </Button>
      {userId ? (
        <Button
          variant={filters.needsMe ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={!!filters.needsMe}
          title={t("needsMeHint")}
          className={cn("hit-area", filters.needsMe && "border-control-border")}
          onClick={() => handleFilterChange({ needsMe: !filters.needsMe })}
        >
          <Hand aria-hidden />
          {/* Icon only on a phone, so the toolbar stays one row. */}
          <span className="max-sm:sr-only">{t("needsMe")}</span>
        </Button>
      ) : null}
      {chips.length > 0 ? (
        <ul aria-label={t("activeFilters")} className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const name = t("chip", { label: chip.label, value: chip.value });
            return (
              <li
                key={chip.id}
                className="bg-muted text-foreground inline-flex min-h-8 min-w-0 items-center rounded-full ps-3 text-sm"
              >
                {chip.id === "tag" && filters.tag && (
                  <span className="me-1.5 flex">
                    {tagOptions.find((item) => item.value === filters.tag)
                      ?.mark ?? <TaskTagDot id={filters.tag} />}
                  </span>
                )}
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
    </div>
  );
}
