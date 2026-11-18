"use client";

import type { TagColor, WorkspaceLabel } from "@sokosumi/core-client";
import { checkFileLabelName } from "@sokosumi/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import type { TaskWorkspaceTag } from "@/app/tasks/types/task-board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  createWorkspaceTag,
  setWorkspaceTagColor,
} from "@/lib/utils/file-search.client";
import {
  useWorkspaceTags,
  workspaceTagsQueryKey,
} from "@/queries/workspace-tags";
import { TaskTagCatalogProvider } from "./task-tag-catalog";
import { TaskTagColorSelect } from "./task-tag-color-select";
import { TaskTagBadge, TaskTagDot } from "./task-tag-colors";
import {
  TaskTagConflict,
  type TaskTagConflictProps,
} from "./task-tag-conflict";
import { WorkspaceTagSuggestions } from "./task-workspace-tag-suggestions";

interface TaskWorkspaceTagPickerProps {
  activeOrganizationId: string | null;
  selected: TaskWorkspaceTag[];
  onChange: (tags: TaskWorkspaceTag[]) => void;
  onCreatingChange?: (pending: boolean) => void;
  disabled?: boolean;
  copying?: boolean;
  conflict?: TaskTagConflictProps;
  suggestions?: TaskWorkspaceTag[];
  onDismissSuggestion?: (tag: TaskWorkspaceTag) => void;
}

export function TaskWorkspaceTagPicker(props: TaskWorkspaceTagPickerProps) {
  return (
    <TaskTagCatalogProvider organizationId={props.activeOrganizationId}>
      {props.copying ? <CopyTagPicker {...props} /> : <TagPicker {...props} />}
    </TaskTagCatalogProvider>
  );
}

/** Archived tags stay on the original but cannot be assigned to a new Task. */
function CopyTagPicker(props: TaskWorkspaceTagPickerProps) {
  const t = useTranslations("App.Tasks.Tags");
  const catalog = useWorkspaceTags(props.activeOrganizationId);
  if (catalog.isPending)
    return (
      <p role="status" className="text-muted-foreground text-xs">
        {t("loading")}
      </p>
    );
  if (catalog.isError)
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => void catalog.refetch()}
      >
        {t("retry")}
      </Button>
    );
  const liveIds = new Set(catalog.data.map((tag) => tag.id));
  return (
    <TagPicker
      {...props}
      selected={props.selected.filter((tag) => liveIds.has(tag.id))}
    />
  );
}

function TagPicker(props: TaskWorkspaceTagPickerProps) {
  const t = useTranslations("App.Tasks.Tags");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const labelId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  function setPending(pending: boolean) {
    setCreating(pending);
    props.onCreatingChange?.(pending);
  }
  return (
    <section aria-labelledby={labelId} className="space-y-2">
      <h2 id={labelId} className="text-muted-foreground text-xs font-medium">
        {t("workspace")}
      </h2>
      <div className="flex flex-wrap items-center gap-1">
        {props.selected.map((tag) => (
          <TaskTagBadge
            id={tag.id}
            color={tag.color}
            key={tag.id}
            className="gap-1"
          >
            <span className="truncate">{tag.displayName}</span>
            {tag.source === "jev" && (
              <span
                title={t("appliedByJev")}
                className="text-muted-foreground inline-flex items-center gap-0.5"
              >
                <Sparkles aria-hidden className="size-3" />
                {t("appliedByJev")}
              </span>
            )}
            <button
              type="button"
              disabled={props.disabled || creating}
              aria-label={t("remove", { name: tag.displayName })}
              className="hit-area relative rounded-sm focus-visible:outline-ring focus-visible:outline-2"
              onClick={() =>
                props.onChange(
                  props.selected.filter((item) => item.id !== tag.id),
                )
              }
            >
              <X className="size-3" aria-hidden />
            </button>
          </TaskTagBadge>
        ))}
        <Popover
          open={open}
          onOpenChange={(next) => {
            if (!creating) setOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              ref={addButton}
              type="button"
              variant="outline"
              size="sm"
              disabled={props.disabled}
            >
              <Plus className="size-4" aria-hidden />
              {t("add")}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            data-task-form-portal=""
            align="start"
            className="w-72 space-y-2"
          >
            {open && (
              <TagChoices
                {...props}
                creating={creating}
                setPending={setPending}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
      {props.conflict && (
        <TaskTagConflict
          taskId={props.conflict.taskId}
          onReload={(tags) => {
            props.conflict?.onReload(tags);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      )}
      {props.suggestions && (
        <WorkspaceTagSuggestions
          suggestions={props.suggestions.filter(
            (tag) => !props.selected.some((kept) => kept.id === tag.id),
          )}
          disabled={props.disabled || creating}
          onAdd={(tag) =>
            props.onChange([...props.selected, { ...tag, source: "manual" }])
          }
          onDismiss={props.onDismissSuggestion}
        />
      )}
    </section>
  );
}

function TagChoices({
  activeOrganizationId,
  selected,
  onChange,
  disabled,
  creating,
  setPending,
}: TaskWorkspaceTagPickerProps & {
  creating: boolean;
  setPending: (pending: boolean) => void;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const [search, setSearch] = useState("");
  const [error, setError] = useState(false);
  const [newColor, setNewColor] = useState<TagColor | null>(null);
  const client = useQueryClient();
  const queryKey = workspaceTagsQueryKey(activeOrganizationId);
  const colorMutation = useMutation({
    mutationFn: ({ id, color }: { id: string; color: TagColor | null }) =>
      setWorkspaceTagColor({ activeOrganizationId, id, color }),
    onMutate: async ({ id, color }) => {
      await client.cancelQueries({ queryKey, exact: true });
      const before = client
        .getQueryData<WorkspaceLabel[]>(queryKey)
        ?.find((tag) => tag.id === id);
      client.setQueryData<WorkspaceLabel[]>(queryKey, (tags) =>
        tags?.map((tag) => (tag.id === id ? { ...tag, color } : tag)),
      );
      return before;
    },
    onError: (_error, variables, before) => {
      if (before)
        client.setQueryData<WorkspaceLabel[]>(queryKey, (tags) =>
          tags?.map((tag) =>
            tag.id === variables.id && tag.color === variables.color
              ? { ...tag, color: before.color }
              : tag,
          ),
        );
      toast.error(t("colorError"));
      return client.invalidateQueries({ queryKey, exact: true });
    },
    onSuccess: async (updated, variables) => {
      // A read started by a failed write must not replace a later confirmation.
      await client.cancelQueries({ queryKey, exact: true }, { revert: false });
      const latest = client
        .getQueryData<WorkspaceLabel[]>(queryKey)
        ?.find((tag) => tag.id === updated.id);
      if (latest && latest.color !== variables.color) {
        await client.invalidateQueries({ queryKey, exact: true });
        return;
      }
      client.setQueryData<WorkspaceLabel[]>(queryKey, (tags) =>
        tags?.map((tag) => (tag.id === updated.id ? updated : tag)),
      );
    },
  });
  const catalog = useWorkspaceTags(activeOrganizationId);
  const name = checkFileLabelName(search);
  const matches =
    catalog.data?.filter((tag) =>
      checkFileLabelName(tag.displayName).normalizedName.includes(
        name.normalizedName,
      ),
    ) ?? [];
  const exact = matches.some(
    (tag) =>
      checkFileLabelName(tag.displayName).normalizedName ===
      name.normalizedName,
  );
  function choose(tag: TaskWorkspaceTag) {
    onChange(
      selected.some((item) => item.id === tag.id)
        ? selected.filter((item) => item.id !== tag.id)
        : [...selected, tag],
    );
  }
  async function create() {
    if (creating || !name.valid || exact) return;
    setPending(true);
    setError(false);
    try {
      const tag = await createWorkspaceTag({
        activeOrganizationId,
        displayName: name.displayName,
        ...(newColor ? { color: newColor } : {}),
      });
      client.setQueryData<WorkspaceLabel[]>(
        workspaceTagsQueryKey(activeOrganizationId),
        (current) =>
          [...(current ?? []).filter((item) => item.id !== tag.id), tag].sort(
            (a, b) => a.displayName.localeCompare(b.displayName),
          ),
      );
      onChange([...selected, tag]);
      setSearch("");
      setNewColor(null);
    } catch {
      // Another person may have created the same normalized name since opening the picker.
      const latest = await catalog.refetch();
      const existing = latest.data?.find(
        (tag) =>
          checkFileLabelName(tag.displayName).normalizedName ===
          name.normalizedName,
      );
      if (existing) {
        if (!selected.some((item) => item.id === existing.id))
          onChange([...selected, existing]);
        setSearch("");
      } else {
        setError(true);
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Input
        aria-label={t("search")}
        placeholder={t("search")}
        value={search}
        disabled={disabled || creating}
        onChange={(event) => {
          setSearch(event.target.value);
          setError(false);
        }}
      />
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {catalog.isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t("loading")}
          </p>
        ) : catalog.isError ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void catalog.refetch()}
          >
            {t("retry")}
          </Button>
        ) : (
          matches.map((tag) => {
            const checked = selected.some((item) => item.id === tag.id);
            return (
              <div key={tag.id} className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disabled || creating}
                  aria-pressed={checked}
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => choose(tag)}
                >
                  <TaskTagDot id={tag.id} color={tag.color} />
                  <span className="min-w-0 flex-1 truncate text-start">
                    {tag.displayName}
                  </span>
                  {checked && <Check className="size-4" aria-hidden />}
                </Button>
                <TaskTagColorSelect
                  id={tag.taskTopicId ?? tag.id}
                  name={tag.displayName}
                  color={tag.color}
                  disabled={disabled || creating || colorMutation.isPending}
                  onChange={(color) =>
                    colorMutation.mutate({ id: tag.id, color })
                  }
                />
              </div>
            );
          })
        )}
      </div>
      {catalog.isSuccess && name.valid && !exact && (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            disabled={disabled}
            loading={creating}
            variant="outline"
            onClick={() => void create()}
          >
            <Plus className="size-4" aria-hidden />
            {t("create", { name: name.displayName })}
          </Button>
          <TaskTagColorSelect
            name={name.displayName}
            color={newColor}
            disabled={disabled || creating}
            onChange={setNewColor}
          />
        </div>
      )}
      {catalog.isSuccess && !search && !matches.length && (
        <p className="text-muted-foreground text-xs">{t("firstTag")}</p>
      )}
      {search && !name.valid && name.problem !== "empty" && (
        <p role="status" className="text-destructive text-xs">
          {t("invalidName")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {t("createError")}
        </p>
      )}
    </>
  );
}
