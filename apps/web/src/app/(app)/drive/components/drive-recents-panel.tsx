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

import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { buildDriveRecentsDayGroups } from "@/app/drive/components/drive-recents-list.utils";
import {
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
} from "@/app/projects/constants";
import { Button } from "@/components/ui/button";
import { DocumentViewer } from "@/components/ui/document-viewer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { ImageViewer } from "@/components/ui/image-viewer";
import { Input } from "@/components/ui/input";
import type { DriveItem, DriveRecentsItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import type { DriveWorkspaceStore } from "@/lib/utils/drive-file-list.client";
import { fetchDriveRecentsPage } from "@/lib/utils/drive-recents-list.client";
import { classifyFilePreview } from "@/lib/utils/file-preview";
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
  onOpenMoveDialog: (item: DriveItem) => void;
  onOpenDeleteDialog: (item: DriveItem) => void;
  onRenameFile: (item: DriveItem, newName: string) => Promise<void>;
  onOpenCopyDialog: (item: DriveRecentsItem & { kind: "task-output" }) => void;
  onItemsChanged: () => void;
}

function RecentsFilePreview({
  name,
  fileUrl,
}: {
  name: string;
  fileUrl: string;
}) {
  const { isImage, documentKind } = classifyFilePreview(fileUrl, name);
  const isPreviewable = isImage || documentKind !== null;
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isDocumentViewerOpen, setIsDocumentViewerOpen] = useState(false);

  if (!isPreviewable) {
    return (
      <span
        className="text-foreground line-clamp-1 text-sm font-medium"
        title={name}
      >
        {name}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (isImage) {
            setIsImageViewerOpen(true);
          } else if (documentKind) {
            setIsDocumentViewerOpen(true);
          }
        }}
        className="text-foreground hover:text-foreground/80 line-clamp-1 text-left text-sm font-medium underline-offset-2 hover:underline"
        title={name}
      >
        {name}
      </button>
      {isImage ? (
        <ImageViewer
          open={isImageViewerOpen}
          onOpenChange={setIsImageViewerOpen}
          src={fileUrl}
          alt={name}
          downloadFilename={name}
        />
      ) : null}
      {documentKind ? (
        <DocumentViewer
          open={isDocumentViewerOpen}
          onOpenChange={setIsDocumentViewerOpen}
          url={fileUrl}
          fileName={name}
          kind={documentKind}
        />
      ) : null}
    </>
  );
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

export function DriveRecentsPanel({
  driveStore,
  activeOrganizationId,
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
  }, [activeOrganizationId, driveStore.scope, t]);

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
    setLoadingMore(true);

    try {
      const page = await fetchDriveRecentsPage({
        scope: driveStore.scope,
        ...(driveStore.scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        cursor: nextCursor,
        signal: controller.signal,
      });

      if (
        controller.signal.aborted ||
        workspaceIdRef.current !== requestedWorkspaceId
      ) {
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
    return <DriveListSkeleton />;
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
            {t("recentsEmptyTitle")}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {t("recentsEmptyDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border",
        PROJECTS_LIST_CARD_MIN_H_CLASS,
      )}
    >
      <div className="px-2 py-2">
        {dayGroups.map((group) => (
          <section key={group.key} className="mb-4">
            <div className="text-muted-foreground px-2 pb-2 text-xs font-medium capitalize">
              {group.key}
            </div>
            <ul className="space-y-0 divide-y divide-border/50">
              {group.items.map((item) => {
                if (item.kind === "drive-file") {
                  const driveItem = toDriveFileItem(item);
                  const isEditing = editingPathname === item.pathname;
                  const extension = getExtensionFromUrl(item.name);

                  return (
                    <li key={item.pathname}>
                      <article
                        className={cn(
                          "-mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
                          PROJECTS_LIST_ROW_LAYOUT_CLASS,
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
                          <div className="flex size-8 shrink-0 items-center justify-center">
                            <FileTypeIcon extension={extension || "file"} />
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
                                <RecentsFilePreview
                                  name={item.name}
                                  fileUrl={item.fileUrl}
                                />
                                <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                                  <span>{formatBytes(item.size)}</span>
                                  <span>
                                    {formatter.dateTime(
                                      new Date(item.activityAt),
                                      {
                                        year: "numeric",
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      },
                                    )}
                                  </span>
                                </div>
                              </div>
                              <div className="text-muted-foreground/70 hidden shrink-0 items-center gap-3 text-xs md:flex">
                                <span>{formatBytes(item.size)}</span>
                                <span>
                                  {formatter.dateTime(
                                    new Date(item.activityAt),
                                    {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                        {!isEditing ? (
                          <div className="shrink-0 pl-2">
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
                          </div>
                        ) : null}
                      </article>
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

                return (
                  <li key={item.taskFileId}>
                    <article
                      className={cn(
                        "-mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
                        PROJECTS_LIST_ROW_LAYOUT_CLASS,
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
                        <div className="flex size-8 shrink-0 items-center justify-center">
                          <FileTypeIcon extension={extension || "file"} />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <RecentsFilePreview
                            name={item.name}
                            fileUrl={item.fileUrl}
                          />
                          {searchContext ? (
                            <p className="text-muted-foreground/70 line-clamp-1 text-xs">
                              {searchContext}
                            </p>
                          ) : null}
                          <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                            <span>
                              {item.size ? formatBytes(item.size) : "—"}
                            </span>
                            <span>
                              {formatter.dateTime(new Date(item.activityAt), {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                        <div className="text-muted-foreground/70 hidden shrink-0 items-center gap-3 text-xs md:flex">
                          <span>
                            {item.size ? formatBytes(item.size) : "—"}
                          </span>
                          <span>
                            {formatter.dateTime(new Date(item.activityAt), {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 pl-2">
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
                                onOpenCopyDialog(item);
                              }}
                            >
                              <Copy className="size-4" aria-hidden />
                              {t("copyToFilesAction")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </article>
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
