"use client";

import type { DriveFile } from "@sokosumi/core-client";
import { isDriveFolderMarkerName } from "@sokosumi/utils";
import {
  Building2,
  ChevronRight,
  FileIcon,
  Folder,
  Home,
  Search,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getEnvPublicConfig } from "@/config/env.public";
import { useDriveOrganizationName } from "@/hooks/effects/use-drive-organization-name";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import {
  driveStoreForActiveWorkspace,
  driveWorkspaceRootLabel,
  listDriveItems,
} from "@/lib/utils/drive-file-list.client";
import { formatBytes } from "@/lib/utils/format-bytes";
import { driveQueryKeys, splitDriveQueryKey } from "@/queries/drive";
import { useScopedQuery } from "@/queries/scoped-queries";

interface DriveFilePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (file: DriveFile) => void;
}

export function DriveFilePicker(props: DriveFilePickerProps) {
  const { data: session } = useSession();
  const workspaceKey = session?.session.activeOrganizationId ?? "personal";

  return <DriveFilePickerWorkspace key={workspaceKey} {...props} />;
}

function DriveFilePickerWorkspace({
  open,
  onOpenChange,
  onSelect,
}: DriveFilePickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [currentFolder, setCurrentFolder] = useState("");

  const debouncedSetSearchQuery = useDebouncedCallback((value: string) => {
    setDebouncedSearchQuery(value);
  }, getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    debouncedSetSearchQuery(value);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl min-w-0 overflow-hidden">
        <DriveFilePickerContent
          open={open}
          onOpenChange={onOpenChange}
          onSelect={onSelect}
          searchQuery={searchQuery}
          debouncedSearchQuery={debouncedSearchQuery}
          currentFolder={currentFolder}
          onSearchChange={handleSearchChange}
          onFolderChange={setCurrentFolder}
        />
      </DialogContent>
    </Dialog>
  );
}

interface DriveFilePickerContentProps extends DriveFilePickerProps {
  searchQuery: string;
  debouncedSearchQuery: string;
  currentFolder: string;
  onSearchChange: (value: string) => void;
  onFolderChange: (folder: string) => void;
}

function DriveFilePickerContent({
  open,
  onOpenChange,
  onSelect,
  searchQuery,
  debouncedSearchQuery,
  currentFolder,
  onSearchChange,
  onFolderChange,
}: DriveFilePickerContentProps) {
  const t = useTranslations("App.Drive");
  const formatter = useFormatter();
  const { data: session } = useSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const driveStore = driveStoreForActiveWorkspace(activeOrganizationId);
  const scope = driveStore.scope;
  const organizationName = useDriveOrganizationName(
    activeOrganizationId,
    session?.user?.id,
  );
  const storeRootLabel = driveWorkspaceRootLabel(driveStore, organizationName, {
    myDrive: t("myDrive"),
    organizationFallback: t("organizationDriveFallback"),
  });

  const trimmedQuery = debouncedSearchQuery.trim();
  const itemsQuery = useScopedQuery({
    ...splitDriveQueryKey(
      driveQueryKeys.picker(driveStore, {
        folder: currentFolder,
        q: trimmedQuery,
      }),
    ),
    queryFn: ({ signal }) =>
      listDriveItems({
        ...driveStore,
        ...(currentFolder ? { folder: currentFolder } : {}),
        ...(trimmedQuery ? { q: trimmedQuery } : {}),
        signal,
      }),
    enabled: open,
  });

  const error =
    itemsQuery.isError && !itemsQuery.isFetching
      ? itemsQuery.error instanceof Error
        ? itemsQuery.error.message
        : t("loadFilesError")
      : null;
  const loading =
    itemsQuery.isPending || (itemsQuery.isError && itemsQuery.isFetching);

  // A picked file is linked into a message, a post or an ad. A data room's
  // files never leave it that way, so the picker does not offer them.
  const pickableItems = (itemsQuery.data ?? []).filter(
    (item) => !isDriveFolderMarkerName(item.name) && !item.dataRoom,
  );

  function handleFileClick(file: DriveFile) {
    onSelect(file);
    onOpenChange(false);
  }

  function navigateToFolder(folderName: string) {
    const newPath = currentFolder
      ? `${currentFolder}/${folderName}`
      : folderName;

    if (newPath === currentFolder) {
      return;
    }

    onFolderChange(newPath);
  }

  function navigateToBreadcrumb(index: number) {
    if (index === -1) {
      onFolderChange("");
    } else {
      const segments = currentFolder.split("/");
      const newPath = segments.slice(0, index + 1).join("/");
      onFolderChange(newPath);
    }
  }

  const breadcrumbSegments = currentFolder ? currentFolder.split("/") : [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("selectTitle")}</DialogTitle>
        <DialogDescription>{t("selectDescription")}</DialogDescription>
      </DialogHeader>

      <div className="min-w-0 w-full">
        <div className="space-y-3 min-w-0 w-full">
          <div className="app-scrollbar min-w-0 overflow-x-auto">
            <nav
              className="text-muted-foreground flex flex-nowrap items-center gap-1 text-sm"
              aria-label={t("breadcrumbNavLabel")}
            >
              <button
                type="button"
                onClick={() => navigateToBreadcrumb(-1)}
                className={cn(
                  "press hover:text-foreground inline-flex shrink-0 items-center whitespace-nowrap transition-colors",
                  breadcrumbSegments.length === 0 &&
                    "text-foreground font-medium",
                )}
                aria-label={storeRootLabel}
                title={storeRootLabel}
              >
                {scope === "org" ? (
                  <Building2 className="size-4" aria-hidden />
                ) : (
                  <Home className="size-4" aria-hidden />
                )}
                <span className="ml-1">{storeRootLabel}</span>
              </button>
              {breadcrumbSegments.map((segment, index) => (
                <span key={index} className="flex shrink-0 items-center gap-1">
                  <ChevronRight className="size-4" aria-hidden />
                  <button
                    type="button"
                    onClick={() => navigateToBreadcrumb(index)}
                    className={cn(
                      "press hover:text-foreground shrink-0 whitespace-nowrap transition-colors",
                      index === breadcrumbSegments.length - 1 &&
                        "text-foreground font-medium",
                    )}
                    title={segment}
                  >
                    {segment}
                  </button>
                </span>
              ))}
            </nav>
          </div>

          <div className="relative min-w-0">
            <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <div className="mt-4 min-w-0 w-full">
          {error ? (
            <div className="text-destructive text-center py-8 text-sm">
              {error}
            </div>
          ) : loading ? (
            <div className="min-h-[400px]">
              <div className="space-y-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex w-full items-start gap-3 rounded-md p-3"
                  >
                    <Skeleton className="size-5 shrink-0 rounded" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : pickableItems.length === 0 ? (
            <div className="text-muted-foreground flex min-h-[400px] items-center justify-center text-center text-sm">
              {searchQuery ? t("noMatchTitle") : t("pickerEmptyMessage")}
            </div>
          ) : (
            <ScrollArea className="h-[400px] pr-4 min-w-0 w-full" shrinkContent>
              <div className="space-y-1">
                {pickableItems.map((item) => {
                  const itemKey =
                    item.type === "file"
                      ? item.pathname
                      : `folder:${item.name}`;

                  if (item.type === "folder") {
                    return (
                      <button
                        key={itemKey}
                        type="button"
                        disabled={itemsQuery.isFetching}
                        className={cn(
                          buttonVariants({ variant: "ghost" }),
                          "h-auto whitespace-normal flex w-full min-w-0 max-w-full items-start gap-3 overflow-hidden rounded-md p-3 text-left",
                        )}
                        onClick={() => navigateToFolder(item.name)}
                      >
                        <Folder className="text-muted-foreground size-5 shrink-0" />
                        <span className="flex min-w-0 w-0 flex-1 flex-col overflow-hidden">
                          <span
                            className="block min-w-0 truncate font-medium"
                            title={item.name}
                          >
                            {item.name}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {t("folder")}
                          </span>
                        </span>
                      </button>
                    );
                  }

                  return (
                    <button
                      key={itemKey}
                      type="button"
                      disabled={itemsQuery.isFetching}
                      className={cn(
                        buttonVariants({ variant: "ghost" }),
                        "h-auto whitespace-normal flex w-full min-w-0 max-w-full items-start gap-3 overflow-hidden rounded-md p-3 text-left",
                      )}
                      onClick={() => handleFileClick(item)}
                    >
                      <FileIcon className="text-muted-foreground size-5 shrink-0" />
                      <span className="flex min-w-0 w-0 flex-1 flex-col overflow-hidden">
                        <span
                          className="block min-w-0 truncate font-medium"
                          title={item.name}
                        >
                          {item.name}
                        </span>
                        <span className="text-muted-foreground flex gap-2 text-xs">
                          {item.size ? (
                            <span>{formatBytes(item.size)}</span>
                          ) : null}
                          <span>
                            {formatter.dateTime(new Date(item.uploadedAt), {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </>
  );
}
