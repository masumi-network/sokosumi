"use client";

import type {
  FileResource,
  HistoryItem,
  TaskListItem,
  WorkspaceLabel,
} from "@sokosumi/core-client";
import { FileText, ListTodo } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  HistorySearchItemIcon,
  HistorySearchItemOwner,
  HistorySearchItemTime,
} from "@/app/components/history-search-item";
import { getHistorySearchItemHref } from "@/app/components/history-search-item-href";
import { HistorySearchItemStatus } from "@/app/components/history-search-item-status";
import { useFileSearchGroup } from "@/app/components/use-file-search-group";
import { useHistorySearchCorpus } from "@/app/components/use-history-search-corpus";
import { useTagSearchGroup } from "@/app/components/use-tag-search-group";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { TaskTagDot } from "@/app/tasks/components/task-tag-colors";
import { taskHref } from "@/app/tasks/utils/task-href";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

interface HistorySearchDialogLabels {
  dialogTitle: string;
  dialogDescription: string;
  searchPlaceholder: string;
  empty: string;
  loading: string;
  error: string;
  created: string;
  filesGroup: string;
  filesSeeAll: string;
  filesFilenameMatch: string;
  tagsGroup: string;
  tagTasksGroup: (tag: string) => string;
  tagsError: string;
  tagTasksError: string;
}

interface HistorySearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: HistorySearchDialogLabels;
  activeOrganizationId: string | null;
}

export function HistorySearchDialog({
  open,
  onOpenChange,
  labels,
  activeOrganizationId,
}: HistorySearchDialogProps) {
  const router = useRouter();
  const { formatDateWithYear } = useLocalizedDateTime();
  const showOwner = activeOrganizationId !== null;
  const { query, setQuery, history, error, isLoading, reset } =
    useHistorySearchCorpus({
      open,
      activeOrganizationId,
      errorLabel: labels.error,
    });
  // The Files group shares the dialog's debounced query. A failure here
  // hides the group; it never takes the other sections down with it.
  const { files } = useFileSearchGroup({
    open,
    activeOrganizationId,
    debouncedQuery: query,
  });
  const { tags, tagsState, topTag, tasks, tasksState } = useTagSearchGroup({
    open,
    activeOrganizationId,
    debouncedQuery: query,
  });
  // Tags still loading or failed never read as "No results found".
  const searching = isLoading || tagsState === "loading";
  const nothingFound =
    !searching &&
    history.length === 0 &&
    tags.length === 0 &&
    files.length === 0 &&
    tagsState !== "error";

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reset();
    }

    onOpenChange(nextOpen);
  }

  function handleSelectFile(file: FileResource) {
    handleOpenChange(false);
    router.push(`/drive/files/${file.id}`);
  }

  function handleSeeAllFiles() {
    handleOpenChange(false);
    router.push(
      `/drive?view=workspace${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`,
    );
  }

  function handleSelectTag(tag: WorkspaceLabel) {
    handleOpenChange(false);
    router.push(`/tasks?tag=${encodeURIComponent(tag.id)}`);
  }

  function handleSelectTask(task: TaskListItem) {
    handleOpenChange(false);
    router.push(taskHref(task));
  }

  function handleSelect(item: HistoryItem) {
    const href = getHistorySearchItemHref(item);
    // Use the same close path as the dialog itself so we reset state
    // and ignore any in-flight history requests.
    handleOpenChange(false);
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={labels.dialogTitle}
      description={labels.dialogDescription}
      commandProps={{ shouldFilter: false }}
      // Phones: pin under the safe area, not centered, so the on-screen
      // keyboard does not cover the results.
      className="max-sm:top-[calc(env(safe-area-inset-top)+1rem)] max-sm:translate-y-0"
    >
      <CommandInput
        placeholder={labels.searchPlaceholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {searching && history.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.loading}
          </div>
        ) : null}

        {nothingFound && error ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {error}
          </div>
        ) : null}

        {nothingFound && !error ? (
          <CommandEmpty>{labels.empty}</CommandEmpty>
        ) : null}

        <TagSearchGroups
          tags={tags}
          tagsState={tagsState}
          topTag={topTag}
          tasks={tasks}
          tasksState={tasksState}
          labels={labels}
          showOwner={showOwner}
          formatShortDate={formatDateWithYear}
          onSelectTag={handleSelectTag}
          onSelectTask={handleSelectTask}
        />

        {history.length > 0 ? (
          <CommandGroup heading={labels.dialogTitle}>
            {history.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.title} ${item.id}`}
                onSelect={() => handleSelect(item)}
                className="flex items-start gap-2"
              >
                <SearchResultRow
                  icon={
                    <HistorySearchItemIcon
                      item={item}
                      className="mt-0.5 size-4"
                    />
                  }
                  title={item.title}
                  createdAt={item.createdAt}
                  owner={showOwner ? item.owner : null}
                  status={<HistorySearchItemStatus item={item} />}
                  formatShortDate={formatDateWithYear}
                  createdLabel={labels.created}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {files.length > 0 ? (
          <CommandGroup heading={labels.filesGroup}>
            {files.map((file) => (
              <CommandItem
                key={file.id}
                value={`file:${file.id}`}
                onSelect={() => handleSelectFile(file)}
                className="flex items-start gap-2"
              >
                <FileText className="mt-0.5 size-4" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate">{file.displayName}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {file.filenameMatch
                      ? labels.filesFilenameMatch
                      : (file.snippet?.text ?? file.mimeType ?? "")}
                  </span>
                </div>
              </CommandItem>
            ))}
            <CommandItem
              value="file:see-all"
              onSelect={handleSeeAllFiles}
              className="text-muted-foreground text-xs"
            >
              {labels.filesSeeAll}
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

interface TagSearchGroupsProps {
  tags: WorkspaceLabel[];
  topTag: WorkspaceLabel | undefined;
  tasks: TaskListItem[];
  tagsState: "loading" | "error" | "ready" | null;
  tasksState: "loading" | "error" | "ready";
  labels: Pick<
    HistorySearchDialogLabels,
    | "tagsGroup"
    | "tagTasksGroup"
    | "tagsError"
    | "tagTasksError"
    | "loading"
    | "created"
  >;
  showOwner: boolean;
  formatShortDate: (date: string | Date) => string;
  onSelectTag: (tag: WorkspaceLabel) => void;
  onSelectTask: (task: TaskListItem) => void;
}

function TagSearchGroups({
  tags,
  topTag,
  tasks,
  tagsState,
  tasksState,
  labels,
  showOwner,
  formatShortDate,
  onSelectTag,
  onSelectTask,
}: TagSearchGroupsProps) {
  return (
    <>
      {tagsState === "error" ? (
        <SearchNote>{labels.tagsError}</SearchNote>
      ) : null}

      {tags.length > 0 ? (
        <CommandGroup heading={labels.tagsGroup}>
          {tags.map((tag) => (
            <CommandItem
              key={tag.id}
              value={`tag:${tag.id}`}
              onSelect={() => onSelectTag(tag)}
              className="flex items-center gap-2"
            >
              <TaskTagDot
                id={tag.id}
                color={tag.color}
                customColor={tag.customColor}
                taskTopicId={tag.taskTopicId}
              />
              <span className="min-w-0 flex-1 truncate">
                #{tag.displayName}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {topTag && (tasks.length > 0 || tasksState !== "ready") ? (
        <CommandGroup heading={labels.tagTasksGroup(topTag.displayName)}>
          {tasksState === "loading" ? (
            <SearchNote>{labels.loading}</SearchNote>
          ) : null}
          {tasksState === "error" ? (
            <SearchNote>{labels.tagTasksError}</SearchNote>
          ) : null}
          {tasks.map((task) => (
            <CommandItem
              key={task.id}
              value={`tag-task:${task.id}`}
              onSelect={() => onSelectTask(task)}
              className="flex items-start gap-2"
            >
              <SearchResultRow
                icon={<ListTodo className="mt-0.5 size-4" aria-hidden />}
                title={task.name}
                createdAt={task.createdAt}
                owner={
                  showOwner && task.owner
                    ? {
                        userId: task.owner.id,
                        name: task.owner.name,
                        image: task.owner.image ?? null,
                      }
                    : null
                }
                status={
                  <TaskStatusBadge
                    status={task.status}
                    className="ml-auto shrink-0"
                  />
                }
                formatShortDate={formatShortDate}
                createdLabel={labels.created}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}

/** One result's body: icon, title over its date, then owner and status. */
function SearchResultRow({
  icon,
  title,
  createdAt,
  owner,
  status,
  formatShortDate,
  createdLabel,
}: {
  icon: ReactNode;
  title: string;
  createdAt: string | Date;
  owner: HistoryItem["owner"];
  status: ReactNode;
  formatShortDate: (date: string | Date) => string;
  createdLabel: string;
}) {
  return (
    <>
      {icon}
      <div className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        <HistorySearchItemTime
          createdAt={createdAt}
          formatShortDate={formatShortDate}
          createdLabel={createdLabel}
          className="text-muted-foreground mt-0.5 block text-left text-xs sm:text-left"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2 self-center">
        {owner ? (
          <HistorySearchItemOwner
            owner={owner}
            className="hidden sm:inline-flex"
          />
        ) : null}
        {status}
      </div>
    </>
  );
}

/** A non-selectable status line in the results, read out when it changes. */
function SearchNote({ children }: { children: string }) {
  return (
    <div
      role="status"
      className="text-muted-foreground px-2 py-3 text-center text-sm"
    >
      {children}
    </div>
  );
}
