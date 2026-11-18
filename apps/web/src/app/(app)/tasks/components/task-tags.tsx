"use client";

import type { TaskTags as TaskTagsDto } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import type { TaskWorkspaceTag } from "@/app/tasks/types/task-board";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { setTaskWorkspaceTags } from "@/lib/actions/task/action";
import { TaskTagBadge } from "./task-tag-colors";
import { TaskWorkspaceTagPicker } from "./task-workspace-tag-picker";

interface TaskTagsProps {
  tags?: TaskTagsDto;
  workspaceTags?: TaskWorkspaceTag[];
}

export function TaskTags({
  tags,
  workspaceTags = [],
  compact = false,
  showManualTopics = true,
  inLink = false,
}: TaskTagsProps & {
  compact?: boolean;
  showManualTopics?: boolean;
  inLink?: boolean;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const badges = [
    ...workspaceTags.map((tag) => ({
      key: tag.id,
      label: tag.displayName,
      color: tag.color,
      source:
        tag.source === "jev"
          ? ("appliedByJev" as const)
          : ("workspace" as const),
    })),
    ...(showManualTopics ? (tags?.manual ?? []) : []).map((id) => ({
      key: id,
      color: undefined,
      label: t(`vocabulary.${id}`),
      source: "manual" as const,
    })),
    ...(tags?.automatic ?? []).map((id) => ({
      key: id,
      color: undefined,
      label: t(`vocabulary.${id}`),
      source: "automatic" as const,
    })),
  ];
  if (!badges.length) return null;
  const visible = badges.slice(0, compact ? 1 : 2);
  const remaining = badges.length - visible.length;
  function renderBadge(tag: (typeof badges)[number]) {
    return (
      <TaskTagBadge
        id={tag.key}
        color={tag.color}
        key={tag.key}
        title={t(tag.source)}
        variant={tag.source === "workspace" ? "secondary" : "outline"}
        className="max-w-full gap-1 rounded-sm font-normal"
      >
        {(tag.source === "automatic" || tag.source === "appliedByJev") && (
          <Sparkles className="size-3 shrink-0" aria-hidden />
        )}
        <span className="truncate">{tag.label}</span>
        {(tag.source === "appliedByJev" || tag.source === "automatic") && (
          <span className="text-muted-foreground shrink-0 text-2xs">
            {t("appliedByJev")}
          </span>
        )}
      </TaskTagBadge>
    );
  }
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1"
      aria-label={t("label")}
    >
      {visible.map(renderBadge)}
      {remaining > 0 &&
        (inLink ? (
          <span
            className="text-muted-foreground text-xs"
            title={badges
              .slice(visible.length)
              .map((tag) => tag.label)
              .join(", ")}
          >
            +{remaining}
          </span>
        ) : (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="relative z-10 min-h-6 px-1.5 text-xs"
                aria-label={t("showAll", { count: badges.length })}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                +{remaining}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              aria-label={t("label")}
              className="w-64 space-y-2"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <p className="text-sm font-medium">{t("label")}</p>
              <div className="flex flex-wrap gap-1">
                {badges.map(renderBadge)}
              </div>
            </PopoverContent>
          </Popover>
        ))}
    </div>
  );
}

/**
 * Read-only. Tags are classified automatically; there is no correction UI. Rows a
 * user corrected while the editor existed still show those choices first, because
 * `mapTaskTags` keeps preferring the stored manual list over the automatic one.
 */
function ClassifiedTags({ tags }: Pick<TaskTagsProps, "tags">) {
  const t = useTranslations("App.Tasks.Tags");
  if (!tags?.manual.length && !tags?.automatic.length) return null;
  return (
    <>
      {tags.manual.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-medium">
            {t("manual")}
          </h2>
          <div className="flex flex-wrap gap-1">
            {tags.manual.map((id) => (
              <TaskTagBadge id={id} key={id} title={t("manual")}>
                {t(`vocabulary.${id}`)}
              </TaskTagBadge>
            ))}
          </div>
        </section>
      )}
      {tags.automatic.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-medium">
            {t("appliedByJev")}
          </h2>
          <div className="flex flex-wrap gap-1">
            {tags.automatic.map((id) => (
              <TaskTagBadge id={id} key={id} title={t("automatic")}>
                <Sparkles className="size-3" aria-hidden />
                {t(`vocabulary.${id}`)}
              </TaskTagBadge>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function TaskTagSection({
  tags,
  workspaceTags = [],
  suggestions = [],
  edit,
}: TaskTagsProps & {
  suggestions?: TaskWorkspaceTag[];
  edit?: { taskId: string; activeOrganizationId: string | null };
}) {
  const t = useTranslations("App.Tasks.Tags");
  return (
    <div className="space-y-4">
      {edit ? (
        <EditableWorkspaceTags
          key={JSON.stringify([edit.taskId, workspaceTags, suggestions])}
          initialTags={workspaceTags}
          initialSuggestions={suggestions}
          {...edit}
        />
      ) : workspaceTags.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-medium">
            {t("workspace")}
          </h2>
          <div className="flex flex-wrap gap-1">
            {workspaceTags.map((tag) => (
              <TaskTagBadge
                id={tag.id}
                color={tag.color}
                key={tag.id}
                title={t(tag.source === "jev" ? "appliedByJev" : "workspace")}
              >
                {tag.source === "jev" && (
                  <Sparkles className="size-3" aria-hidden />
                )}
                {tag.displayName}
                {tag.source === "jev" && (
                  <span className="text-muted-foreground text-2xs">
                    {t("appliedByJev")}
                  </span>
                )}
              </TaskTagBadge>
            ))}
          </div>
        </section>
      ) : null}
      <ClassifiedTags tags={tags} />
      {!edit &&
        !workspaceTags.length &&
        !tags?.manual.length &&
        !tags?.automatic.length && (
          <p className="text-muted-foreground text-xs">{t("empty")}</p>
        )}
    </div>
  );
}

function EditableWorkspaceTags({
  initialTags,
  initialSuggestions,
  taskId,
  activeOrganizationId,
}: {
  initialTags: TaskWorkspaceTag[];
  initialSuggestions: TaskWorkspaceTag[];
  taskId: string;
  activeOrganizationId: string | null;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const [confirmed, setConfirmed] = useState({
    tags: initialTags,
    suggestions: initialSuggestions,
  });
  const [current, setOptimistic] = useOptimistic(confirmed);
  const [conflict, setConflict] = useState(false);
  const [saving, startTransition] = useTransition();
  function save(
    next: typeof confirmed,
    patch: {
      workspaceTagIds?: string[];
      expectedWorkspaceTagIds?: string[];
      dismissedWorkspaceTagIds?: string[];
    },
  ) {
    startTransition(async () => {
      setOptimistic(next);
      try {
        const result = await setTaskWorkspaceTags({ taskId, ...patch });
        if (result.ok) {
          setConfirmed({
            tags: result.value.workspaceTags,
            suggestions: result.value.workspaceTagSuggestions,
          });
          return;
        }
        if (
          result.error.kind === CORE_API_ERROR_KINDS.TASK_WORKSPACE_TAGS_CHANGED
        ) {
          setConflict(true);
          return;
        }
      } catch {
        // A transport failure also restores the last confirmed selection.
      }
      toast.error(t("saveError"));
    });
  }
  function handleChange(tags: TaskWorkspaceTag[]) {
    const ids = new Set(tags.map((tag) => tag.id));
    const dismissed = current.tags
      .filter((tag) => tag.source === "jev" && !ids.has(tag.id))
      .map((tag) => tag.id);
    save(
      {
        tags,
        suggestions: current.suggestions.filter((tag) => !ids.has(tag.id)),
      },
      {
        workspaceTagIds: [...ids],
        expectedWorkspaceTagIds: current.tags.map((tag) => tag.id),
        ...(dismissed.length ? { dismissedWorkspaceTagIds: dismissed } : {}),
      },
    );
  }
  function handleDismiss(tag: TaskWorkspaceTag) {
    save(
      {
        ...current,
        suggestions: current.suggestions.filter((item) => item.id !== tag.id),
      },
      { dismissedWorkspaceTagIds: [tag.id] },
    );
  }
  return (
    <TaskWorkspaceTagPicker
      activeOrganizationId={activeOrganizationId}
      selected={current.tags}
      suggestions={current.suggestions}
      onDismissSuggestion={handleDismiss}
      onChange={handleChange}
      disabled={saving || conflict}
      conflict={
        conflict
          ? {
              taskId,
              onReload: ({ workspaceTags, workspaceTagSuggestions }) => {
                setConfirmed({
                  tags: workspaceTags,
                  suggestions: workspaceTagSuggestions,
                });
                setConflict(false);
              },
            }
          : undefined
      }
    />
  );
}
