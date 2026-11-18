"use client";

import type { WorkspaceLabel } from "@sokosumi/core-client";
import { checkFileLabelName } from "@sokosumi/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { TaskWorkspaceTag } from "@/app/tasks/types/task-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createWorkspaceTag } from "@/lib/utils/file-search.client";
import {
  useWorkspaceTags,
  workspaceTagsQueryKey,
} from "@/queries/workspace-tags";

interface TaskWorkspaceTagPickerProps {
  activeOrganizationId: string | null;
  selected: TaskWorkspaceTag[];
  onChange: (tags: TaskWorkspaceTag[]) => void;
  onCreatingChange?: (pending: boolean) => void;
  disabled?: boolean;
  copying?: boolean;
}

export function TaskWorkspaceTagPicker(props: TaskWorkspaceTagPickerProps) {
  return props.copying ? (
    <CopyTagPicker {...props} />
  ) : (
    <TagPicker {...props} />
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
          <Badge variant="secondary" key={tag.id} className="gap-1">
            {tag.displayName}
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
          </Badge>
        ))}
        <Popover
          open={open}
          onOpenChange={(next) => {
            if (!creating) setOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button
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
  const client = useQueryClient();
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
              <Button
                key={tag.id}
                type="button"
                variant="ghost"
                disabled={disabled || creating}
                aria-pressed={checked}
                className="w-full justify-between"
                onClick={() => choose(tag)}
              >
                <span className="truncate">{tag.displayName}</span>
                {checked && <Check className="size-4" aria-hidden />}
              </Button>
            );
          })
        )}
      </div>
      {catalog.isSuccess && name.valid && !exact && (
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
