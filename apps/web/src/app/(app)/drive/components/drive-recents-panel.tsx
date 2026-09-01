"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import {
  Copy,
  Download,
  Edit3,
  Folder,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  DriveFilePreview,
  DriveItemCard,
  driveItemActivation,
} from "@/app/drive/components/drive-item-card";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { buildDriveRecentsDayGroups } from "@/app/drive/components/drive-recents-list.utils";
import {
  DRIVE_FILE_TYPE_ICON_CLASS,
  driveItemIconWellClass,
  driveItemMetaDesktopClass,
  driveItemMetaMobileClass,
  driveItemsPanelClass,
  driveRecentsDayItemsClass,
} from "@/app/drive/components/drive-view-layout";
import { PROJECTS_LIST_CARD_MIN_H_CLASS } from "@/app/projects/constants";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { Input } from "@/components/ui/input";
import type { DriveItem, DriveRecentsItem } from "@/lib/clients/generated/core";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import type { DriveWorkspaceStore } from "@/lib/utils/drive-file-list.client";
import { fetchDriveRecentsPage } from "@/lib/utils/drive-recents-list.client";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import type { FilesSortBy, FilesSortOrder } from "@/lib/utils/files-sort";
import { formatBytes } from "@/lib/utils/format-bytes";

function appendDownloadParam(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("download", "1");
  return parsed.toString();
}

function handleDownload(fileUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = appendDownloadParam(fileUrl);
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

interface DriveRecentsPanelProps {
  driveStore: DriveWorkspaceStore;
  activeOrganizationId: string | null;
  searchQuery: string;
  reloadToken?: number;
  viewMode?: FilesViewMode;
  sortBy?: FilesSortBy;
  sortOrder?: FilesSortOrder;
  onOpenMoveDialog: (item: DriveItem) => void;
  onOpenDeleteDialog: (item: DriveItem) => void;
  onRenameFile: (item: DriveItem, newName: string) => Promise<void>;
  onOpenCopyDialog: (item: DriveRecentsItem & { kind: "task-output" }) => void;
  onItemsChanged: () => void;
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
  };
}

function formatActivityAt(
  formatter: ReturnType<typeof useFormatter>,
  activityAt: string | Date,
): string {
  return formatter.dateTime(new Date(activityAt), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DriveRecentsPanel({
  driveStore,
  activeOrganizationId,
  searchQuery,
  reloadToken = 0,
  viewMode = "list",
  sortBy,
  sortOrder,
  onOpenMoveDialog,
  onOpenDeleteDialog,
  onRenameFile,
  onOpenCopyDialog,
  onItemsChanged,
}: DriveRecentsPanelProps): ReactElement {
  const t = useTranslations("App.Drive");
  const formatter = useFormatter();
  const { locale } = useLocalizedDateTime();
  const [items, setItems] = useState<DriveRecentsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [editingPathname, setEditingPathname] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const workspaceIdRef = useRef(activeOrganizationId);
  workspaceIdRef.current = activeOrganizationId;
  const trimmedSearchQuery = searchQuery.trim();

  const dayGroups = useMemo(
    () => buildDriveRecentsDayGroups(items, locale),
    [items, locale],
  );

  const loadRecents = useCallback(async () => {
    loadAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    setLoadingMore(false);
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const requestedWorkspaceId = activeOrganizationId;

    try {
      if (driveStore.scope === "org" && !activeOrganizationId) {
        if (!controller.signal.aborted) {
          setItems([]);
          setNextCursor(null);
          setLoading(false);
        }
        return;
      }

      if (!controller.signal.aborted) {
        setItems([]);
        setNextCursor(null);
        setLoading(true);
      }

      const page = await fetchDriveRecentsPage({
        scope: driveStore.scope,
        ...(driveStore.scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        ...(trimmedSearchQuery ? { q: trimmedSearchQuery } : {}),
        ...(sortBy ? { sortBy } : {}),
        ...(sortOrder ? { sortOrder } : {}),
        signal: controller.signal,
      });

      if (
        controller.signal.aborted ||
        workspaceIdRef.current !== requestedWorkspaceId
      ) {
        return;
      }

      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      console.error("Failed to load Drive recents", error);
      toast.error(t("loadRecentsError"));
      if (workspaceIdRef.current === requestedWorkspaceId) {
        setItems([]);
        setNextCursor(null);
      }
    } finally {
      if (
        !controller.signal.aborted &&
        workspaceIdRef.current === requestedWorkspaceId
      ) {
        setLoading(false);
      }
    }
  }, [
    activeOrganizationId,
    driveStore.scope,
    reloadToken,
    sortBy,
    sortOrder,
    t,
    trimmedSearchQuery,
  ]);

  useEffect(() => {
    void loadRecents();
    return () => {
      loadAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
    };
  }, [loadRecents]);

  async function loadMoreRecents() {
    if (!nextCursor || loadingMore) {
      return;
    }

    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    const requestedWorkspaceId = activeOrganizationId;
    const searchQueryAtRequest = trimmedSearchQuery;
    const sortByAtRequest = sortBy;
    const sortOrderAtRequest = sortOrder;
    setLoadingMore(true);

    try {
      const page = await fetchDriveRecentsPage({
        scope: driveStore.scope,
        ...(driveStore.scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        cursor: nextCursor,
        ...(searchQueryAtRequest ? { q: searchQueryAtRequest } : {}),
        ...(sortByAtRequest ? { sortBy: sortByAtRequest } : {}),
        ...(sortOrderAtRequest ? { sortOrder: sortOrderAtRequest } : {}),
        signal: controller.signal,
      });

      const queryStillMatches =
        workspaceIdRef.current === requestedWorkspaceId &&
        trimmedSearchQuery === searchQueryAtRequest &&
        sortBy === sortByAtRequest &&
        sortOrder === sortOrderAtRequest;

      if (controller.signal.aborted || !queryStillMatches) {
        return;
      }

      setItems((current) => {
        const seen = new Set(
          current.map((item) =>
            item.kind === "drive-file" ? item.pathname : item.taskFileId,
          ),
        );
        const appended = page.items.filter((item) => {
          const id =
            item.kind === "drive-file" ? item.pathname : item.taskFileId;
          return !seen.has(id);
        });
        return [...current, ...appended];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      console.error("Failed to load more Drive recents", error);
      toast.error(t("loadMoreRecentsError"));
    } finally {
      if (
        !controller.signal.aborted &&
        workspaceIdRef.current === requestedWorkspaceId
      ) {
        setLoadingMore(false);
      }
    }
  }

  async function handleRenameConfirm(item: DriveItem, newName: string) {
    await onRenameFile(item, newName);
    setEditingPathname(null);
    setEditingName("");
    onItemsChanged();
    await loadRecents();
  }

  if (loading) {
    return <DriveListSkeleton viewMode={viewMode} />;
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "bg-muted/30 border-border/50 -mx-6 flex flex-col items-center justify-center overflow-hidden rounded-none border-0 py-12 text-center md:mx-0 md:rounded-xl md:border",
          PROJECTS_LIST_CARD_MIN_H_CLASS,
        )}
      >
        <div className="max-w-sm">
          <h2 className="text-foreground text-lg font-semibold">
            {trimmedSearchQuery ? t("noMatchTitle") : t("recentsEmptyTitle")}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {trimmedSearchQuery
              ? t("noMatchDescription")
              : t("recentsEmptyDescription")}
          </p>
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
      <div className={cn(viewMode === "grid" ? "py-1" : "px-2 py-2")}>
        {dayGroups.map((group) => (
          <section key={group.key} className="mb-4">
            <div className="text-muted-foreground px-2 pb-2 text-xs font-medium capitalize">
              {group.key}
            </div>
            <ul className={driveRecentsDayItemsClass(viewMode)}>
              {group.items.map((item) => {
                if (item.kind === "drive-file") {
                  const driveItem = toDriveFileItem(item);
                  const isEditing = editingPathname === item.pathname;
                  const extension = getExtensionFromUrl(item.name);
                  const { isImage, documentKind } = classifyFilePreview(
                    item.fileUrl,
                    item.name,
                  );
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
                          className="size-8"
                          aria-label={t("moreActions")}
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            handleDownload(
                              appendDownloadParam(item.fileUrl),
                              item.name,
                            );
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
                        fileUrl={item.fileUrl}
                        isImage={isImage}
                        documentKind={documentKind}
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

                const extension = getExtensionFromUrl(item.name);
                const { isImage, documentKind } = classifyFilePreview(
                  item.fileUrl,
                  item.name,
                );
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
                      isImage={isImage}
                      documentKind={documentKind}
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
                                  className="size-8"
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
                                    handleDownload(
                                      appendDownloadParam(item.fileUrl),
                                      item.name,
                                    );
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
                              <p className="text-muted-foreground/70 line-clamp-1 text-xs">
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

        {nextCursor ? (
          <div className="flex justify-center py-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadMoreRecents()}
              disabled={loadingMore}
            >
              {t("loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
