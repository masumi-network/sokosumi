"use client";

import type { TaskTagId, TaskTags as TaskTagsDto } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { Clock } from "lucide-react";
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
import type {
  TaskTagSnapshot,
  TaskTagWrite,
} from "@/lib/actions/task/task-write-input";
import { cn } from "@/lib/utils";
import {
  representedTaskTopics,
  useTaskTagCatalog,
  useVisibleTaskTopicIds,
} from "./task-tag-catalog";
import { TaskTagBadge, TaskTagRemoveButton } from "./task-tag-colors";
import { TaskWorkspaceTagPicker } from "./task-workspace-tag-picker";

interface TaskTagsProps {
  tags?: TaskTagsDto;
  workspaceTags?: TaskWorkspaceTag[];
}

/**
 * Rows a user corrected while the original editor existed still show those choices
 * first, because `mapTaskTags` keeps preferring the stored manual list over the
 * automatic one. Editors can remove either kind from the saved Task.
 */
function useTopicTags(
  tags: TaskTagsDto | undefined,
  workspaceTags: TaskWorkspaceTag[],
  showManual = true,
) {
  const t = useTranslations("App.Tasks.Tags");
  const ids = [
    ...(showManual ? (tags?.manual ?? []) : []),
    ...(tags?.automatic ?? []),
  ];
  // Automatic tags kept from before the last edit until the new ones arrive.
  const checking = new Set(tags?.checking ? tags.automatic : []);
  return useVisibleTaskTopicIds(ids, workspaceTags).map((id) => ({
    id,
    displayName: t(`vocabulary.${id}`),
    checking: checking.has(id),
  }));
}

function TagsChecking({ className }: { className?: string }) {
  const t = useTranslations("App.Tasks.Tags");
  return (
    <p
      role="status"
      className={cn(
        "text-muted-foreground flex items-center gap-1 text-xs",
        className,
      )}
    >
      <Clock aria-hidden className="size-3.5 shrink-0" />
      {t("checking")}
    </p>
  );
}

function renderTagBadge(
  tag: Pick<
    TaskWorkspaceTag,
    "id" | "displayName" | "color" | "customColor" | "taskTopicId"
  >,
  quiet = false,
) {
  return (
    <TaskTagBadge
      id={tag.id}
      key={tag.id}
      color={tag.color}
      customColor={tag.customColor}
      taskTopicId={tag.taskTopicId}
      quiet={quiet}
    >
      <span className="truncate">{tag.displayName}</span>
    </TaskTagBadge>
  );
}

export function TaskTags({
  tags,
  workspaceTags = [],
  compact = false,
  quiet = false,
  showManualTopics = true,
  inLink = false,
}: TaskTagsProps & {
  compact?: boolean;
  /** Tags with no box, for a board card. */
  quiet?: boolean;
  showManualTopics?: boolean;
  inLink?: boolean;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const topics = useTopicTags(tags, workspaceTags, showManualTopics);
  const badges = [...workspaceTags, ...topics];
  if (!badges.length) return null;
  const visible = badges.slice(0, compact ? 1 : 2);
  const remaining = badges.length - visible.length;
  return (
    <div
      role="group"
      className={cn(
        "flex min-w-0 items-center gap-1",
        // One tag on one line: it truncates, the count after it stays whole.
        compact ? "*:first:min-w-0 *:first:shrink" : "flex-wrap",
      )}
      aria-label={t("label")}
    >
      {visible.map((tag) => renderTagBadge(tag, quiet))}
      {remaining > 0 &&
        (inLink ? (
          <span
            className="text-muted-foreground text-xs"
            title={badges
              .slice(visible.length)
              .map((tag) => tag.displayName)
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
                className={cn(
                  "relative z-10 min-h-6 px-1.5 text-xs",
                  quiet && "text-muted-foreground",
                  // On a card's one-line row the count keeps one fixed height.
                  compact && "h-6",
                )}
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
                {badges.map((tag) => renderTagBadge(tag))}
              </div>
            </PopoverContent>
          </Popover>
        ))}
    </div>
  );
}

function TopicBadges({
  tags,
  workspaceTags,
  onRemove,
  disabled,
}: {
  tags?: TaskTagsDto;
  workspaceTags: TaskWorkspaceTag[];
  onRemove?: (id: TaskTagId) => void;
  disabled?: boolean;
}) {
  return useTopicTags(tags, workspaceTags).map((topic) => (
    <TaskTagBadge key={topic.id} id={topic.id}>
      <span
        className={cn("truncate", topic.checking && "text-muted-foreground")}
      >
        {topic.displayName}
      </span>
      {onRemove && (
        <TaskTagRemoveButton
          name={topic.displayName}
          disabled={disabled}
          onRemove={() => onRemove(topic.id)}
        />
      )}
    </TaskTagBadge>
  ));
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

  if (edit) {
    return (
      <EditableWorkspaceTags
        key={JSON.stringify([edit.taskId, workspaceTags, suggestions, tags])}
        initialTags={workspaceTags}
        initialSuggestions={suggestions}
        topics={tags}
        {...edit}
      />
    );
  }
  const hasTags =
    workspaceTags.length || tags?.manual.length || tags?.automatic.length;
  return (
    <section aria-label={t("label")} className="space-y-2">
      <h2 className="text-muted-foreground text-xs font-medium">
        {t("label")}
      </h2>
      {hasTags ? (
        <div className="flex flex-wrap items-center gap-1">
          {workspaceTags.map((tag) => renderTagBadge(tag))}
          <TopicBadges tags={tags} workspaceTags={workspaceTags} />
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{t("empty")}</p>
      )}
      {tags?.checking && <TagsChecking />}
    </section>
  );
}

function EditableWorkspaceTags({
  initialTags,
  initialSuggestions,
  topics,
  taskId,
  activeOrganizationId,
}: {
  initialTags: TaskWorkspaceTag[];
  initialSuggestions: TaskWorkspaceTag[];
  topics?: TaskTagsDto;
  taskId: string;
  activeOrganizationId: string | null;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const catalog = useTaskTagCatalog();
  const [confirmed, setConfirmed] = useState<TaskTagSnapshot>({
    workspaceTags: initialTags,
    workspaceTagSuggestions: initialSuggestions,
    tags: topics ?? { manual: [], automatic: [], rejected: [] },
  });
  const [current, setOptimistic] = useOptimistic(confirmed);
  const [conflict, setConflict] = useState(false);
  const [saving, startTransition] = useTransition();
  function save(
    next: TaskTagSnapshot,
    patch: TaskTagWrite & { expectedWorkspaceTagIds?: string[] },
  ) {
    startTransition(async () => {
      const dismissed = new Set(patch.dismissedTopicIds);
      setOptimistic({
        ...next,
        tags: {
          ...next.tags,
          manual: next.tags.manual.filter((id) => !dismissed.has(id)),
          automatic: next.tags.automatic.filter((id) => !dismissed.has(id)),
          rejected: [...new Set([...next.tags.rejected, ...dismissed])],
        },
      });
      try {
        const result = await setTaskWorkspaceTags({ taskId, ...patch });
        if (result.ok) {
          setConfirmed(result.value);
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
    const removed = current.workspaceTags.filter((tag) => !ids.has(tag.id));
    const dismissed = removed
      .filter((tag) => tag.source === "jev")
      .map((tag) => tag.id);
    const removedTopics = representedTaskTopics(catalog, removed);
    const retainedTopics = representedTaskTopics(catalog, tags);
    const dismissedTopicIds = [
      ...current.tags.manual,
      ...current.tags.automatic,
    ].filter((id) => removedTopics.has(id) && !retainedTopics.has(id));
    save(
      {
        ...current,
        workspaceTags: tags,
        workspaceTagSuggestions: current.workspaceTagSuggestions.filter(
          (tag) => !ids.has(tag.id),
        ),
      },
      {
        workspaceTagIds: [...ids],
        expectedWorkspaceTagIds: current.workspaceTags.map((tag) => tag.id),
        ...(dismissed.length ? { dismissedWorkspaceTagIds: dismissed } : {}),
        ...(dismissedTopicIds.length ? { dismissedTopicIds } : {}),
      },
    );
  }
  function handleDismiss(tag: TaskWorkspaceTag) {
    save(
      {
        ...current,
        workspaceTagSuggestions: current.workspaceTagSuggestions.filter(
          (item) => item.id !== tag.id,
        ),
      },
      { dismissedWorkspaceTagIds: [tag.id] },
    );
  }
  return (
    <TaskWorkspaceTagPicker
      activeOrganizationId={activeOrganizationId}
      selected={current.workspaceTags}
      suggestions={current.workspaceTagSuggestions}
      onDismissSuggestion={handleDismiss}
      onChange={handleChange}
      disabled={saving || conflict}
      conflict={
        conflict
          ? {
              taskId,
              onReload: (snapshot) => {
                setConfirmed(snapshot);
                setConflict(false);
              },
            }
          : undefined
      }
    >
      <TopicBadges
        tags={current.tags}
        workspaceTags={current.workspaceTags}
        onRemove={(id) => save(current, { dismissedTopicIds: [id] })}
        disabled={saving || conflict}
      />
      {/* The picker's row wraps; this takes its own last line. */}
      {current.tags.checking && <TagsChecking className="order-last w-full" />}
    </TaskWorkspaceTagPicker>
  );
}
