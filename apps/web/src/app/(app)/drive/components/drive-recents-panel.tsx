"use client";

import type { DriveItem, DriveRecentsItem } from "@sokosumi/core-client";
import { getExtensionFromUrl } from "@sokosumi/utils";
import {
  Copy,
  Download,
  Edit3,
  Folder,
  FolderOpen,
  Link2,
  MoreHorizontal,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactElement, useMemo, useState } from "react";
import { CropForSocial } from "@/app/drive/components/crop-for-social";
import {
  DriveFilePreview,
  DriveItemCard,
  driveFileUrl,
  driveItemActivation,
  forcedDownloadUrl,
} from "@/app/drive/components/drive-item-card";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { buildDriveRecentsDayGroups } from "@/app/drive/components/drive-recents-list.utils";
import type { DriveShareItem } from "@/app/drive/components/drive-share-dialog";
import {
  DRIVE_FILE_TYPE_ICON_CLASS,
  driveItemArticleClass,
  driveItemBodyClass,
  driveItemIconWellClass,
  driveItemMetaDesktopClass,
  driveItemMetaMobileClass,
  driveItemNameClass,
  driveItemsPanelClass,
  driveRecentsDayItemsClass,
} from "@/app/drive/components/drive-view-layout";
import { PROJECTS_LIST_CARD_MIN_H_CLASS } from "@/app/projects/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { Input } from "@/components/ui/input";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import type { DriveWorkspaceStore } from "@/lib/utils/drive-file-list.client";
import { fetchDriveRecentsPage } from "@/lib/utils/drive-recents-list.client";
import { formatBytes } from "@/lib/utils/format-bytes";
import { driveQueryKeys, splitDriveQueryKey } from "@/queries/drive";
import { useScopedInfiniteQuery } from "@/queries/scoped-queries";

function handleDownload(fileUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = forcedDownloadUrl(fileUrl);
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

interface DriveRecentsPanelProps {
  driveStore: DriveWorkspaceStore;
  searchQuery: string;
  /** Label ids. Only Drive files carrying any of them are listed. */
  tagLabelIds: string[];
  viewMode?: FilesViewMode;
  onOpenMoveDialog: (item: DriveItem) => void;
  /** Opens the link dialog for an uploaded file the catalog knows. */
  onShareFile: (item: DriveShareItem) => void;
  onOpenDeleteDialog: (item: DriveItem) => void;
  onRenameFile: (item: DriveItem, newName: string) => Promise<void>;
  onOpenCopyDialog: (item: DriveRecentsItem & { kind: "task-output" }) => void;
  /** Opens the file picker; the upload lands in the workspace root. */
  onUpload: () => void;
  uploading: boolean;
  onOpenWorkspace: () => void;
}

function toDriveFileItem(
  item: DriveRecentsItem & { kind: "drive-file" },
): DriveItem {
  return {
    type: "file",
    name: item.name,
    fileUrl: item.fileUrl,
    pathname: item.pathname,
    size: item.size,
    uploadedAt: item.activityAt,
    dataRoom: item.dataRoom,
  };
}

function recentsItemKey(item: DriveRecentsItem): string {
  if (item.kind === "drive-file") return item.pathname;
  if (item.kind === "table") return item.tableId;
  return item.taskFileId;
}

function formatActivityAt(
  formatter: ReturnType<typeof useFormatter>,
  activityAt: string | Date,
): string {
  return formatter.dateTime(new Date(activityAt), "dateTimeWithYear");
}

export function DriveRecentsPanel({
  driveStore,
  searchQuery,
  tagLabelIds,
  viewMode = "list",
  onOpenMoveDialog,
  onShareFile,
  onOpenDeleteDialog,
  onRenameFile,
  onOpenCopyDialog,
  onUpload,
  uploading,
  onOpenWorkspace,
}: DriveRecentsPanelProps): ReactElement {
  const t = useTranslations("App.Drive");
  const formatter = useFormatter();
  const { locale } = useLocalizedDateTime();
  const [editingPathname, setEditingPathname] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const trimmedSearchQuery = searchQuery.trim();
  const normalizedTagLabelIds = useMemo(
    () => tagLabelIds.filter(Boolean),
    [tagLabelIds],
  );
  const isFiltered =
    trimmedSearchQuery.length > 0 || normalizedTagLabelIds.length > 0;
  const isEnabled =
    driveStore.scope !== "org" || Boolean(driveStore.organizationId);

  const recentsQuery = useScopedInfiniteQuery({
    ...splitDriveQueryKey(
      driveQueryKeys.recents(driveStore, {
        q: trimmedSearchQuery,
        tagLabelIds: normalizedTagLabelIds,
      }),
    ),
    queryFn: ({ pageParam, signal }) =>
      fetchDriveRecentsPage({
        scope: driveStore.scope,
        ...(driveStore.scope === "org"
          ? { organizationId: driveStore.organizationId }
          : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(trimmedSearchQuery ? { q: trimmedSearchQuery } : {}),
        ...(normalizedTagLabelIds.length > 0
          ? { tagLabelIds: normalizedTagLabelIds }
          : {}),
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isEnabled,
    // Table editor writes live outside the Drive cache, so returning to
    // Recents shows cached rows and refetches in the background.
    staleTime: 0,
  });

  const items = useMemo(() => {
    const pages = recentsQuery.data?.pages ?? [];
    const seen = new Set<string>();
    const flattened: DriveRecentsItem[] = [];
    for (const page of pages) {
      for (const item of page.items) {
        const key = recentsItemKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        flattened.push(item);
      }
    }
    return flattened;
  }, [recentsQuery.data?.pages]);

  const dayGroups = useMemo(
    () => buildDriveRecentsDayGroups(items, locale),
    [items, locale],
  );

  const isRefreshingPageOne =
    recentsQuery.isFetching && !recentsQuery.isFetchingNextPage;
  const isEmptyError = recentsQuery.isError && items.length === 0;
  const isLoadingList =
    isEnabled &&
    (recentsQuery.isPending || (items.length === 0 && recentsQuery.isFetching));

  async function handleRenameConfirm(item: DriveItem, newName: string) {
    await onRenameFile(item, newName);
    setEditingPathname(null);
    setEditingName("");
  }

  if (isLoadingList) {
    return <DriveListSkeleton viewMode={viewMode} />;
  }

  if (isEmptyError) {
    return (
      <div
        className={cn(
          "bg-card-background flex flex-col items-center justify-center overflow-hidden rounded-xl px-4 py-12 text-center text-sm",
          PROJECTS_LIST_CARD_MIN_H_CLASS,
        )}
        role="alert"
      >
        <p>{t("loadRecentsError")}</p>
        <Button
          type="button"
          className="mt-3"
          variant="outline"
          size="sm"
          onClick={() => void recentsQuery.refetch()}
        >
          {t("Files.retry")}
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "bg-card-background flex flex-col items-center justify-center overflow-hidden rounded-xl px-4 py-12 text-center",
          PROJECTS_LIST_CARD_MIN_H_CLASS,
        )}
      >
        <div className="max-w-sm">
          <h2 className="text-foreground text-lg font-semibold">
            {isFiltered ? t("noMatchTitle") : t("recentsEmptyTitle")}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {isFiltered
              ? t("noMatchDescription")
              : t("recentsEmptyDescription")}
          </p>
          {/* A first visit has nothing here yet, and Upload lives on
              Workspace, so the empty state offers both next steps. */}
          {!isFiltered && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={uploading}
                onClick={onUpload}
              >
                <Upload className="size-4" aria-hidden />
                {t("uploadButton")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={onOpenWorkspace}
              >
                <FolderOpen className="size-4" aria-hidden />
                {t("recentsEmptyOpenWorkspace")}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={driveItemsPanelClass(viewMode)}
      data-testid={
        viewMode === "grid" ? "files-layout-grid" : "files-layout-list"
      }
    >
      <div className={cn(viewMode === "grid" ? "py-1" : "py-2")}>
        {dayGroups.map((group) => (
          <section key={group.key} className="mb-4">
            <div className="text-muted-foreground px-4 pb-2 text-xs font-medium capitalize">
              {group.key}
            </div>
            <ul className={driveRecentsDayItemsClass(viewMode)}>
              {group.items.map((item) => {
                if (item.kind === "drive-file") {
                  const driveItem = toDriveFileItem(item);
                  const isEditing = editingPathname === item.pathname;
                  const extension = getExtensionFromUrl(item.name);
                  const activityLabel = formatActivityAt(
                    formatter,
                    item.activityAt,
                  );

                  const driveFileActions = isEditing ? null : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-10 md:size-8"
                          aria-label={t("moreActions")}
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            handleDownload(driveFileUrl(item), item.name);
                          }}
                        >
                          <Download className="size-4" aria-hidden />
                          {t("downloadAction")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            setEditingPathname(item.pathname);
                            setEditingName(item.name);
                          }}
                        >
                          <Edit3 className="size-4" aria-hidden />
                          {t("renameAction")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            onOpenMoveDialog(driveItem);
                          }}
                        >
                          <Folder className="size-4" aria-hidden />
                          {t("moveAction")}
                        </DropdownMenuItem>
                        {item.resourceId ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              if (item.resourceId)
                                onShareFile({
                                  target: {
                                    kind: "file",
                                    resourceId: item.resourceId,
                                  },
                                  name: item.name,
                                });
                            }}
                          >
                            <Link2 className="size-4" aria-hidden />
                            {t("shareAction")}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={(event) => {
                            event.preventDefault();
                            onOpenDeleteDialog(driveItem);
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden />
                          {t("deleteAction")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );

                  return (
                    <li key={item.pathname}>
                      <DriveFilePreview
                        name={item.name}
                        fileUrl={driveFileUrl(item)}
                        sizeBytes={item.size}
                        detailsHref={
                          item.resourceId
                            ? `/drive/files/${item.resourceId}`
                            : null
                        }
                        imageActions={
                          <CropForSocial
                            pathname={item.pathname}
                            name={item.name}
                            mimeType={null}
                            sizeBytes={item.size}
                            store={driveStore}
                          />
                        }
                      >
                        {({ activate, nameEl, viewers }) => (
                          <DriveItemCard
                            viewMode={viewMode}
                            {...driveItemActivation(
                              isEditing ? undefined : activate,
                              item.name,
                            )}
                            actions={driveFileActions}
                          >
                            <div className={driveItemIconWellClass(viewMode)}>
                              <div className={DRIVE_FILE_TYPE_ICON_CLASS}>
                                <FileTypeIcon extension={extension || "file"} />
                              </div>
                            </div>
                            {isEditing ? (
                              <Input
                                value={editingName}
                                onChange={(event) =>
                                  setEditingName(event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void handleRenameConfirm(
                                      driveItem,
                                      editingName,
                                    );
                                  } else if (event.key === "Escape") {
                                    setEditingPathname(null);
                                    setEditingName("");
                                  }
                                }}
                                className="h-8 flex-1"
                                autoFocus
                              />
                            ) : (
                              <>
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  {nameEl}
                                  <DriveRecentsLabels
                                    category={item.category}
                                    tags={item.tags}
                                    viewMode={viewMode}
                                  />
                                  <div
                                    className={driveItemMetaMobileClass(
                                      viewMode,
                                    )}
                                  >
                                    <span>{formatBytes(item.size)}</span>
                                    <span>{activityLabel}</span>
                                  </div>
                                </div>
                                <div
                                  className={driveItemMetaDesktopClass(
                                    viewMode,
                                  )}
                                >
                                  <span>{formatBytes(item.size)}</span>
                                  <span>{activityLabel}</span>
                                </div>
                                {viewers}
                              </>
                            )}
                          </DriveItemCard>
                        )}
                      </DriveFilePreview>
                    </li>
                  );
                }

                if (item.kind === "table") {
                  const activityLabel = formatActivityAt(
                    formatter,
                    item.activityAt,
                  );
                  // A table opens its editor, so it is a link wearing the
                  // Files item row, as in the Tables tab.
                  return (
                    <li key={item.tableId}>
                      <Link
                        href={`/drive/tables/${item.tableId}`}
                        className={cn(
                          driveItemArticleClass(viewMode),
                          "focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:ring-offset-2",
                        )}
                      >
                        <div className={driveItemBodyClass(viewMode)}>
                          <div className={driveItemIconWellClass(viewMode)}>
                            <Table2
                              aria-hidden
                              className={cn(
                                "text-muted-foreground",
                                viewMode === "grid" ? "size-4" : "size-5",
                              )}
                            />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className={driveItemNameClass()}>
                              {item.name}
                            </span>
                            <div className={driveItemMetaMobileClass(viewMode)}>
                              <span>{t("tableKind")}</span>
                              <span>{activityLabel}</span>
                            </div>
                          </div>
                          <div className={driveItemMetaDesktopClass(viewMode)}>
                            <span>{t("tableKind")}</span>
                            <span>{activityLabel}</span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                }

                const extension = getExtensionFromUrl(item.name);
                const searchContext = [
                  item.taskName,
                  item.projectName ??
                    (item.projectId === null ? t("noProject") : null),
                ]
                  .filter(Boolean)
                  .join(" · ");
                const activityLabel = formatActivityAt(
                  formatter,
                  item.activityAt,
                );
                const sizeLabel =
                  item.size != null ? formatBytes(item.size) : "—";

                return (
                  <li key={item.taskFileId}>
                    <DriveFilePreview
                      name={item.name}
                      fileUrl={item.fileUrl}
                      sizeBytes={item.size}
                      detailsHref={null}
                    >
                      {({ activate, nameEl, viewers }) => (
                        <DriveItemCard
                          viewMode={viewMode}
                          {...driveItemActivation(activate, item.name)}
                          actions={
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-10 md:size-8"
                                  aria-label={t("moreActions")}
                                >
                                  <MoreHorizontal
                                    className="size-4"
                                    aria-hidden
                                  />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={() => {
                                    handleDownload(item.fileUrl, item.name);
                                  }}
                                >
                                  <Download className="size-4" aria-hidden />
                                  {t("downloadAction")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    onOpenCopyDialog(item);
                                  }}
                                >
                                  <Copy className="size-4" aria-hidden />
                                  {t("copyToFilesAction")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          }
                        >
                          <div className={driveItemIconWellClass(viewMode)}>
                            <div className={DRIVE_FILE_TYPE_ICON_CLASS}>
                              <FileTypeIcon extension={extension || "file"} />
                            </div>
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            {nameEl}
                            {searchContext && viewMode !== "grid" ? (
                              <p className="text-muted-foreground line-clamp-1 text-xs">
                                {searchContext}
                              </p>
                            ) : null}
                            <div className={driveItemMetaMobileClass(viewMode)}>
                              <span>{sizeLabel}</span>
                              <span>{activityLabel}</span>
                            </div>
                          </div>
                          <div className={driveItemMetaDesktopClass(viewMode)}>
                            <span>{sizeLabel}</span>
                            <span>{activityLabel}</span>
                          </div>
                          {viewers}
                        </DriveItemCard>
                      )}
                    </DriveFilePreview>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {recentsQuery.isError ? (
          <div
            className="flex items-center justify-center gap-2 py-4 text-sm"
            role="alert"
          >
            <span className="text-muted-foreground">
              {recentsQuery.isFetchNextPageError
                ? t("loadMoreRecentsError")
                : t("loadRecentsError")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={
                recentsQuery.isFetchNextPageError
                  ? recentsQuery.isFetchingNextPage
                  : isRefreshingPageOne
              }
              disabled={
                recentsQuery.isFetchNextPageError && isRefreshingPageOne
              }
              onClick={() =>
                void (recentsQuery.isFetchNextPageError
                  ? recentsQuery.fetchNextPage({ cancelRefetch: false })
                  : recentsQuery.refetch())
              }
            >
              {t("Files.retry")}
            </Button>
          </div>
        ) : recentsQuery.hasNextPage ? (
          <div className="flex justify-center py-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={recentsQuery.isFetchingNextPage}
              disabled={isRefreshingPageOne}
              onClick={() =>
                void recentsQuery.fetchNextPage({ cancelRefetch: false })
              }
            >
              {t("loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type DriveRecentsLabel = (DriveRecentsItem & {
  kind: "drive-file";
})["tags"][number];

/** Labels shown inline before the rest are counted. */
const VISIBLE_LABELS = { list: 3, grid: 2 } as const;

/**
 * What a file is about, as compact chips under its name. Read-only here: a
 * tag is removed from the file's detail view, where removing it can be undone.
 */
function DriveRecentsLabels({
  category,
  tags,
  viewMode,
}: {
  category: DriveRecentsLabel | null;
  tags: DriveRecentsLabel[];
  viewMode: FilesViewMode;
}): ReactElement | null {
  const labels = category ? [category, ...tags] : tags;
  if (labels.length === 0) return null;
  const visible = labels.slice(0, VISIBLE_LABELS[viewMode]);
  const hidden = labels.length - visible.length;

  return (
    <ul
      className="flex min-w-0 flex-wrap items-center gap-1"
      data-testid="drive-recents-labels"
    >
      {visible.map((label, index) => (
        <li key={label.labelId} className="min-w-0">
          <Badge
            variant={category && index === 0 ? "muted" : "outline"}
            className="max-w-40 truncate"
          >
            {label.displayName}
          </Badge>
        </li>
      ))}
      {hidden > 0 ? (
        <li className="text-muted-foreground text-xs tabular-nums">
          +{hidden}
        </li>
      ) : null}
    </ul>
  );
}
