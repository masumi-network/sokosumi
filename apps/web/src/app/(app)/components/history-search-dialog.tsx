"use client";

import { FileText } from "lucide-react";
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
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type {
  FileResource,
  HistoryItem,
} from "@/lib/clients/generated/core/types.gen";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

interface HistorySearchDialogLabels {
  dialogTitle: string;
  dialogDescription: string;
  searchPlaceholder: string;
  empty: string;
  loading: string;
  error: string;
  updated: string;
  filesGroup: string;
  filesSeeAll: string;
  filesFilenameMatch: string;
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
  const { formatTimeAgo } = useLocalizedDateTime();
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

        {!isLoading && error && history.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && history.length === 0 ? (
          <CommandEmpty>{labels.empty}</CommandEmpty>
        ) : null}

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
                    updatedAt={item.updatedAt}
                    formatTimeAgo={formatTimeAgo}
                    updatedLabel={labels.updated}
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
