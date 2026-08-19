"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import {
  Check,
  ChevronRight,
  Download,
  Edit3,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import {
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
} from "@/app/projects/constants";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getEnvPublicConfig } from "@/config/env.public";
import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";
import { useSession } from "@/lib/auth/auth.client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveItem } from "@/lib/clients/generated/core";
import {
  deleteDriveFilesDelete,
  deleteDriveFoldersDelete,
  getUsersByIdOrganizations,
  patchDriveFilesMove,
  patchDriveFilesRename,
  patchDriveFoldersRename,
  postDriveFolders,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { listDriveItems } from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import { formatBytes } from "@/lib/utils/format-bytes";

function appendDownloadParam(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

interface FileNameWithPreviewProps {
  item: DriveItem;
  isPreviewable: boolean;
  isImage: boolean;
  documentKind: "office" | "pdf" | "text" | null;
}

function FileNameWithPreview({
  item,
  isPreviewable,
  isImage,
  documentKind,
}: FileNameWithPreviewProps) {
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isDocumentViewerOpen, setIsDocumentViewerOpen] = useState(false);

  if (item.type === "folder" || !isPreviewable) {
    return (
      <span className="text-foreground line-clamp-1 text-sm font-medium">
        {item.name}
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
      >
        {item.name}
      </button>
      {isImage && (
        <ImageViewer
          open={isImageViewerOpen}
          onOpenChange={setIsImageViewerOpen}
          src={item.fileUrl}
          alt={item.name}
          downloadFilename={item.name}
        />
      )}
      {documentKind && (
        <DocumentViewer
          open={isDocumentViewerOpen}
          onOpenChange={setIsDocumentViewerOpen}
          url={item.fileUrl}
          fileName={item.name}
          kind={documentKind}
        />
      )}
    </>
  );
}

export default function DrivePage(): ReactElement {
  const t = useTranslations("App.Drive");
  const formatter = useFormatter();
  const { data: session } = useSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editingItemPath, setEditingItemPath] = useState<string | null>(null);
  const [editingItemName, setEditingItemName] = useState("");
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DriveItem | null>(null);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [itemToMove, setItemToMove] = useState<DriveItem | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string | null>(
    null,
  );
  const [movingItem, setMovingItem] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const loadItemsAbortRef = useRef<AbortController | null>(null);
  const fetchOrgNameAbortRef = useRef<AbortController | null>(null);

  const scopeParam = searchParams.get("scope");
  const scope: "me" | "org" = scopeParam === "org" ? "org" : "me";
  const folderParam = searchParams.get("folder") || "";
  const currentFolder = folderParam;

  useRegisterBreadcrumbOverride({
    pathname,
    segments: [{ label: t("breadcrumb"), href: "/drive" }],
  });

  const debouncedSetSearchQuery = useDebouncedCallback((value: string) => {
    setDebouncedSearchQuery(value);
  }, getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    debouncedSetSearchQuery(value);
  }

  const loadItems = useCallback(async () => {
    loadItemsAbortRef.current?.abort();
    const controller = new AbortController();
    loadItemsAbortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      if (scope === "org" && !activeOrganizationId) {
        if (!controller.signal.aborted) {
          setItems([]);
        }
        return;
      }

      const loaded = await listDriveItems({
        scope,
        ...(scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        ...(currentFolder ? { folder: currentFolder } : {}),
        ...(debouncedSearchQuery.trim()
          ? { q: debouncedSearchQuery.trim() }
          : {}),
        signal: controller.signal,
      });

      if (!controller.signal.aborted) {
        setItems(loaded);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error("Failed to load Drive items", err);
        setError(t("loadFilesError"));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [scope, activeOrganizationId, currentFolder, debouncedSearchQuery, t]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    async function fetchOrganizationName() {
      fetchOrgNameAbortRef.current?.abort();
      const controller = new AbortController();
      fetchOrgNameAbortRef.current = controller;

      if (!activeOrganizationId || !session?.user?.id) {
        if (!controller.signal.aborted) {
          setOrganizationName(null);
        }
        return;
      }

      try {
        const response = await getUsersByIdOrganizations({
          client: getBrowserCoreClient(),
          path: { id: session.user.id },
        });
        const orgs = response.data?.data || [];
        const activeOrg = orgs.find((org) => org.id === activeOrganizationId);
        if (!controller.signal.aborted) {
          setOrganizationName(activeOrg?.name ?? null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setOrganizationName(null);
        }
      }
    }

    void fetchOrganizationName();
  }, [activeOrganizationId, session?.user?.id]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      await uploadDriveFile(file, {
        scope,
        ...(scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        ...(currentFolder ? { folder: currentFolder } : {}),
        onUploadProgress: (progress) => {
          setUploadProgress(progress.percentage);
        },
      });

      await loadItems();
    } catch (err) {
      if (isDriveFileUploadDuplicate(err)) {
        setError(null);
        toast.error(t("uploadDuplicateError"));
      } else {
        console.error("Failed to upload file", err);
        toast.error(t("uploadError"));
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
      event.target.value = "";
    }
  }

  async function handleRename(item: DriveItem, newName: string) {
    if (!newName.trim()) {
      return;
    }

    setError(null);
    try {
      if (item.type === "file") {
        await patchDriveFilesRename({
          client: getBrowserCoreClient(),
          body: {
            oldPathname: item.pathname,
            newFilename: newName.trim(),
          },
          throwOnError: true,
        });
      } else {
        await patchDriveFoldersRename({
          client: getBrowserCoreClient(),
          body: {
            oldFolderPath: currentFolder
              ? `${currentFolder}/${item.name}`
              : item.name,
            newFolderPath: currentFolder
              ? `${currentFolder}/${newName.trim()}`
              : newName.trim(),
            scope,
            ...(scope === "org" && activeOrganizationId
              ? { organizationId: activeOrganizationId }
              : {}),
          },
          throwOnError: true,
        });
      }

      setEditingItemPath(null);
      setEditingItemName("");
      await loadItems();
    } catch (err) {
      console.error(`Failed to rename ${item.type}`, err);
      setError(t("renameError"));
    }
  }

  function openDeleteDialog(item: DriveItem) {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!itemToDelete) {
      return;
    }

    setError(null);
    try {
      if (itemToDelete.type === "file") {
        await deleteDriveFilesDelete({
          client: getBrowserCoreClient(),
          body: {
            pathname: itemToDelete.pathname,
          },
          throwOnError: true,
        });
      } else {
        await deleteDriveFoldersDelete({
          client: getBrowserCoreClient(),
          body: {
            folderPath: currentFolder
              ? `${currentFolder}/${itemToDelete.name}`
              : itemToDelete.name,
            scope,
            ...(scope === "org" && activeOrganizationId
              ? { organizationId: activeOrganizationId }
              : {}),
          },
          throwOnError: true,
        });
      }

      setDeleteDialogOpen(false);
      setItemToDelete(null);
      await loadItems();
    } catch (err) {
      console.error(`Failed to delete ${itemToDelete.type}`, err);
      setError(
        itemToDelete.type === "folder"
          ? t("deleteFolderError")
          : t("deleteError"),
      );
    }
  }

  function handleDownload(fileUrl: string, fileName: string) {
    const link = document.createElement("a");
    link.href = appendDownloadParam(fileUrl);
    link.download = fileName;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function startEdit(item: DriveItem) {
    setEditingItemPath(item.type === "file" ? item.pathname : item.name);
    setEditingItemName(item.name);
  }

  function cancelEdit() {
    setEditingItemPath(null);
    setEditingItemName("");
  }

  function switchScope(newScope: "me" | "org") {
    if (newScope === scope) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", newScope);
    params.delete("folder");
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToFolder(folderName: string) {
    const params = new URLSearchParams(searchParams.toString());
    const newPath = currentFolder
      ? `${currentFolder}/${folderName}`
      : folderName;
    params.set("folder", newPath);
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToBreadcrumb(index: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (index === -1) {
      params.delete("folder");
    } else {
      const segments = currentFolder.split("/");
      const newPath = segments.slice(0, index + 1).join("/");
      params.set("folder", newPath);
    }
    router.push(`/drive?${params.toString()}`);
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) {
      return;
    }

    setCreatingFolder(true);
    setError(null);
    try {
      await postDriveFolders({
        client: getBrowserCoreClient(),
        body: {
          folderPath: currentFolder
            ? `${currentFolder}/${newFolderName.trim()}`
            : newFolderName.trim(),
          scope,
          ...(scope === "org" && activeOrganizationId
            ? { organizationId: activeOrganizationId }
            : {}),
        },
        throwOnError: true,
      });

      setCreateFolderDialogOpen(false);
      setNewFolderName("");
      await loadItems();
    } catch (err) {
      console.error("Failed to create folder", err);

      // Check for duplicate folder (409)
      const isDuplicate =
        err &&
        typeof err === "object" &&
        ("status" in err
          ? (err.status as number) === 409
          : "response" in err &&
              err.response &&
              typeof err.response === "object" &&
              "status" in err.response
            ? (err.response.status as number) === 409
            : false);

      if (isDuplicate) {
        setCreateFolderDialogOpen(false);
        setNewFolderName("");
        toast.error(t("createFolderDuplicateError"));
      } else {
        toast.error(t("createFolderError"));
      }
    } finally {
      setCreatingFolder(false);
    }
  }

  function openMoveDialog(item: DriveItem) {
    setItemToMove(item);
    setSelectedDestination(null);
    setMoveDialogOpen(true);
  }

  async function handleMoveConfirm() {
    if (!itemToMove || selectedDestination === null) {
      return;
    }

    setMovingItem(true);
    setError(null);
    try {
      await patchDriveFilesMove({
        client: getBrowserCoreClient(),
        body: {
          sourcePathname:
            itemToMove.type === "file"
              ? itemToMove.pathname
              : currentFolder
                ? `${currentFolder}/${itemToMove.name}`
                : itemToMove.name,
          targetFolderPath: selectedDestination,
          itemType: itemToMove.type,
          ...(itemToMove.type === "folder"
            ? {
                scope,
                ...(scope === "org" && activeOrganizationId
                  ? { organizationId: activeOrganizationId }
                  : {}),
              }
            : {}),
        },
        throwOnError: true,
      });

      setMoveDialogOpen(false);
      setItemToMove(null);
      setSelectedDestination(null);
      await loadItems();
    } catch (err) {
      console.error(`Failed to move ${itemToMove.type}`, err);
      setError(
        itemToMove.type === "folder"
          ? t("moveFolderError")
          : t("moveFileError"),
      );
    } finally {
      setMovingItem(false);
    }
  }

  const breadcrumbSegments = currentFolder ? currentFolder.split("/") : [];

  const availableDestinations = (() => {
    if (!itemToMove) return [];

    const destinations: Array<{ path: string; label: string }> = [];

    destinations.push({ path: "", label: t("rootFolder") });

    breadcrumbSegments.forEach((_, index) => {
      const ancestorPath = breadcrumbSegments.slice(0, index + 1).join("/");
      if (
        itemToMove.type === "folder" &&
        (ancestorPath === itemToMove.name ||
          ancestorPath === `${currentFolder}/${itemToMove.name}` ||
          ancestorPath.startsWith(
            currentFolder
              ? `${currentFolder}/${itemToMove.name}/`
              : `${itemToMove.name}/`,
          ))
      ) {
        return;
      }
      destinations.push({
        path: ancestorPath,
        label: breadcrumbSegments.slice(0, index + 1).join(" / "),
      });
    });

    const siblingFolders = items.filter(
      (item) =>
        item.type === "folder" &&
        item.name !== itemToMove.name &&
        !(
          itemToMove.type === "folder" &&
          currentFolder === "" &&
          item.name === itemToMove.name
        ),
    );

    siblingFolders.forEach((folder) => {
      const folderPath = currentFolder
        ? `${currentFolder}/${folder.name}`
        : folder.name;
      destinations.push({
        path: folderPath,
        label: currentFolder
          ? `${breadcrumbSegments.join(" / ")} / ${folder.name}`
          : folder.name,
      });
    });

    return destinations;
  })();

  const emptyState = !loading && items.length === 0;
  const hasItems = items.length > 0;

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFabOpen() {
    fileInputRef.current?.click();
  }

  return (
    <div className={cn("w-full px-2", LIST_MOBILE_CREATE_FAB_CLEARANCE)}>
      <Tabs value={scope} onValueChange={(v) => switchScope(v as "me" | "org")}>
        <div className="mb-4 flex flex-col gap-4 md:mb-6">
          <div className="flex items-center justify-between gap-4">
            <TabsList className="bg-muted/50 flex items-center gap-1 self-start rounded-lg p-1">
              <TabsTrigger
                value="me"
                className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
              >
                {t("myDriveTab")}
              </TabsTrigger>
              {activeOrganizationId && (
                <TabsTrigger
                  value="org"
                  className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
                >
                  {organizationName || t("organizationTabFallback")}
                </TabsTrigger>
              )}
            </TabsList>

            <div className="hidden items-center gap-2 md:flex">
              <div className="relative">
                <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  type="text"
                  placeholder={t("searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-64 pl-8"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setCreateFolderDialogOpen(true)}
              >
                <FolderPlus className="size-4" aria-hidden />
                {t("createFolder")}
              </Button>
              <Label htmlFor="file-upload" className="cursor-pointer">
                <Button
                  disabled={uploading}
                  size="sm"
                  className="gap-1.5"
                  asChild
                >
                  <span>
                    <Upload className="size-4" aria-hidden />
                    {uploading
                      ? t("uploadingProgress", { progress: uploadProgress })
                      : t("uploadButton")}
                  </span>
                </Button>
              </Label>
              <Input
                id="file-upload"
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
            </div>
          </div>

          {(currentFolder || breadcrumbSegments.length > 0) && (
            <nav
              className="text-muted-foreground flex items-center gap-1 text-sm"
              aria-label="Breadcrumb"
            >
              <button
                type="button"
                onClick={() => navigateToBreadcrumb(-1)}
                className="hover:text-foreground transition-colors"
              >
                {t("myDriveTab")}
              </button>
              {breadcrumbSegments.map((segment, index) => (
                <span key={index} className="flex items-center gap-1">
                  <ChevronRight className="size-4" aria-hidden />
                  <button
                    type="button"
                    onClick={() => navigateToBreadcrumb(index)}
                    className={cn(
                      "hover:text-foreground transition-colors",
                      index === breadcrumbSegments.length - 1 &&
                        "text-foreground font-medium",
                    )}
                  >
                    {segment}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>

        <div className="relative mb-6 md:hidden">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-8"
          />
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive mb-6 rounded-lg border border-destructive/20 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <TabsContent value={scope} className="mt-0">
          {loading ? (
            <div
              className={cn(
                "bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border",
                PROJECTS_LIST_CARD_MIN_H_CLASS,
              )}
            >
              <div className="divide-border/50 divide-y px-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <article
                    key={i}
                    className={cn(
                      "-mx-2 flex items-center gap-1 rounded-lg px-2",
                      PROJECTS_LIST_ROW_LAYOUT_CLASS,
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
                      <div className="flex size-8 shrink-0 items-center justify-center">
                        <Skeleton className="size-4" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Skeleton className="h-4 w-32 sm:w-48" />
                        <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                      <div className="text-muted-foreground/70 hidden shrink-0 items-center gap-3 text-xs md:flex">
                        <Skeleton className="h-3 w-12" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                    <div className="shrink-0 pl-2">
                      <Skeleton className="size-8" />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : emptyState ? (
            <div
              className={cn(
                "bg-muted/30 border-border/50 flex flex-col items-center justify-center rounded-xl border px-6 py-12 text-center",
                PROJECTS_LIST_CARD_MIN_H_CLASS,
              )}
            >
              <div className="max-w-sm">
                <h2 className="text-foreground text-lg font-semibold">
                  {searchQuery ? t("noMatchTitle") : t("emptyTitle")}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {searchQuery
                    ? t("noMatchDescription")
                    : t("emptyDescription")}
                </p>
              </div>
            </div>
          ) : hasItems ? (
            <div
              className={cn(
                "bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border",
                PROJECTS_LIST_CARD_MIN_H_CLASS,
              )}
            >
              <div className="divide-border/50 divide-y px-2">
                {items.map((item) => {
                  const itemKey =
                    item.type === "file"
                      ? item.pathname
                      : `folder:${item.name}`;
                  const isEditing =
                    (item.type === "file" &&
                      editingItemPath === item.pathname) ||
                    (item.type === "folder" && editingItemPath === item.name);

                  const extension =
                    item.type === "file"
                      ? getExtensionFromUrl(item.name)
                      : null;
                  const { isImage, documentKind } =
                    item.type === "file"
                      ? classifyFilePreview(item.fileUrl, item.name)
                      : { isImage: false, documentKind: null };
                  const isPreviewable = isImage || documentKind !== null;

                  return (
                    <article
                      key={itemKey}
                      className={cn(
                        "-mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
                        PROJECTS_LIST_ROW_LAYOUT_CLASS,
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
                        <div className="flex size-8 shrink-0 items-center justify-center">
                          {item.type === "folder" ? (
                            <Folder className="text-muted-foreground size-5" />
                          ) : (
                            <FileTypeIcon extension={extension || "file"} />
                          )}
                        </div>

                        {isEditing ? (
                          <Input
                            value={editingItemName}
                            onChange={(e) => setEditingItemName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleRename(item, editingItemName);
                              } else if (e.key === "Escape") {
                                cancelEdit();
                              }
                            }}
                            className="h-8 flex-1"
                            autoFocus
                          />
                        ) : (
                          <>
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              {item.type === "folder" ? (
                                <button
                                  type="button"
                                  onClick={() => navigateToFolder(item.name)}
                                  className="text-foreground hover:text-foreground/80 line-clamp-1 text-left text-sm font-medium underline-offset-2 hover:underline"
                                >
                                  {item.name}
                                </button>
                              ) : (
                                <FileNameWithPreview
                                  item={item}
                                  isPreviewable={isPreviewable}
                                  isImage={isImage}
                                  documentKind={documentKind}
                                />
                              )}
                              <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                                {item.type === "file" ? (
                                  <>
                                    <span>
                                      {item.size ? formatBytes(item.size) : "—"}
                                    </span>
                                    <span>
                                      {formatter.dateTime(
                                        new Date(item.uploadedAt),
                                        {
                                          year: "numeric",
                                          month: "short",
                                          day: "numeric",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        },
                                      )}
                                    </span>
                                  </>
                                ) : (
                                  <span>{t("folder")}</span>
                                )}
                              </div>
                            </div>
                            {item.type === "file" && (
                              <div className="text-muted-foreground/70 hidden shrink-0 items-center gap-3 text-xs md:flex">
                                <span>
                                  {item.size ? formatBytes(item.size) : "—"}
                                </span>
                                <span>
                                  {formatter.dateTime(
                                    new Date(item.uploadedAt),
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
                            )}
                            {item.type === "folder" && (
                              <div className="text-muted-foreground/70 hidden shrink-0 text-xs md:block">
                                {t("folder")}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      <div className="shrink-0 pl-2">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void handleRename(item, editingItemName)
                              }
                              title={t("saveAction")}
                            >
                              <Check className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={cancelEdit}
                              title={t("cancelAction")}
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        ) : (
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
                              {item.type === "file" && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    handleDownload(item.fileUrl, item.name);
                                  }}
                                >
                                  <Download className="size-4" aria-hidden />
                                  {t("downloadAction")}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onSelect={() => {
                                  startEdit(item);
                                }}
                                disabled={editingItemPath !== null}
                              >
                                <Edit3 className="size-4" aria-hidden />
                                {t("renameAction")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  openMoveDialog(item);
                                }}
                                disabled={editingItemPath !== null}
                              >
                                <Folder className="size-4" aria-hidden />
                                {t("moveAction")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => {
                                  openDeleteDialog(item);
                                }}
                                disabled={editingItemPath !== null}
                              >
                                <Trash2 className="size-4" aria-hidden />
                                {t("deleteAction")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      <ListMobileCreateFab
        ariaLabel={t("uploadFab")}
        onOpen={handleFabOpen}
        icon={Upload}
        progress={uploading ? uploadProgress : undefined}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {itemToDelete?.type === "folder"
                ? t("deleteFolderDialogTitle")
                : t("deleteDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {itemToDelete?.type === "folder"
                ? t("deleteFolderDialogDescription", {
                    folderName: itemToDelete.name,
                  })
                : t("deleteDialogDescription", {
                    fileName: itemToDelete?.name || "",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteDialogCancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteConfirm();
              }}
            >
              {t("deleteDialogConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={createFolderDialogOpen}
        onOpenChange={setCreateFolderDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createFolderDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("createFolderDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t("folderName")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreateFolder();
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateFolderDialogOpen(false);
                setNewFolderName("");
              }}
            >
              {t("cancelAction")}
            </Button>
            <Button
              onClick={() => void handleCreateFolder()}
              disabled={creatingFolder || !newFolderName.trim()}
            >
              {t("createFolderDialogConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {itemToMove &&
                t("moveDialogTitle", { itemName: itemToMove.name })}
            </DialogTitle>
            <DialogDescription>{t("moveDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {availableDestinations.map((dest) => (
              <button
                key={dest.path}
                type="button"
                onClick={() => setSelectedDestination(dest.path)}
                className={cn(
                  "text-foreground hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  selectedDestination === dest.path &&
                    "bg-muted border-primary",
                )}
              >
                <Folder className="text-muted-foreground size-4 shrink-0" />
                <span className="line-clamp-1 flex-1">{dest.label}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMoveDialogOpen(false);
                setItemToMove(null);
                setSelectedDestination(null);
              }}
            >
              {t("cancelAction")}
            </Button>
            <Button
              onClick={() => void handleMoveConfirm()}
              disabled={movingItem || selectedDestination === null}
            >
              {t("moveHere")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
