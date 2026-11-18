"use client";

import type {
  FileResource,
  HistoryItem,
  TaskListItem,
  WorkspaceLabel,
} from "@sokosumi/core-client";
import { FileText, ListTodo } from "lucide-react";
import { useRouter } from "next/navigation";
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
  const { tags, topTag, tasks } = useTagSearchGroup({
    open,
    activeOrganizationId,
    debouncedQuery: query,
  });
  const hasOtherResults = tags.length > 0 || files.length > 0;

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
    >
      <CommandInput
        placeholder={labels.searchPlaceholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isLoading && history.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.loading}
          </div>
        ) : null}

        {!isLoading && error && history.length === 0 && !hasOtherResults ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && history.length === 0 && !hasOtherResults ? (
          <CommandEmpty>{labels.empty}</CommandEmpty>
        ) : null}

        <TagSearchGroups
          tags={tags}
          topTag={topTag}
          tasks={tasks}
          labels={labels}
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
                <HistorySearchItemIcon item={item} className="mt-0.5 size-4" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate">{item.title}</span>
                  <HistorySearchItemTime
                    createdAt={item.createdAt}
                    formatShortDate={formatDateWithYear}
                    createdLabel={labels.created}
                    className="text-muted-foreground mt-0.5 block text-left text-xs sm:text-left"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2 self-center">
                  {showOwner && (
                    <HistorySearchItemOwner
                      owner={item.owner}
                      className="hidden sm:inline-flex"
                    />
                  )}
                  <HistorySearchItemStatus item={item} />
                </div>
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
  labels: Pick<HistorySearchDialogLabels, "tagsGroup" | "tagTasksGroup">;
  onSelectTag: (tag: WorkspaceLabel) => void;
  onSelectTask: (task: TaskListItem) => void;
}

function TagSearchGroups({
  tags,
  topTag,
  tasks,
  labels,
  onSelectTag,
  onSelectTask,
}: TagSearchGroupsProps) {
  return (
    <>
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

      {topTag && tasks.length > 0 ? (
        <CommandGroup heading={labels.tagTasksGroup(topTag.displayName)}>
          {tasks.map((task) => (
            <CommandItem
              key={task.id}
              value={`tag-task:${task.id}`}
              onSelect={() => onSelectTask(task)}
              className="flex items-center gap-2"
            >
              <ListTodo className="size-4" />
              <span className="min-w-0 flex-1 truncate">{task.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}
