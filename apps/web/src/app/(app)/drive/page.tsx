"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import {
  Building2,
  Check,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Folder,
  FolderPlus,
  Folders,
  Home,
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
import { DriveTasksFilters } from "@/app/drive/components/drive-tasks-filters";
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
import type {
  DriveItem,
  DriveTasksListItem,
} from "@/lib/clients/generated/core";
import {
  deleteDriveFilesDelete,
  deleteDriveFoldersDelete,
  getDriveTasks,
  getProjects,
  getTasks,
  getUsersByIdOrganizations,
  patchDriveFilesMove,
  patchDriveFilesRename,
  patchDriveFoldersRename,
  postDriveFolders,
  postDriveTasksCopy,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { listDriveItems } from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  isDuplicateResourceError,
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
      <span
        className="text-foreground line-clamp-1 text-sm font-medium"
        title={item.name}
      >
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
        title={item.name}
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

type ExploreItem =
  | ({ kind: "blob-file" | "blob-folder" } & DriveItem)
  | { kind: "tasks-root" }
  | ({
      kind: "task-project" | "task-no-project" | "task" | "task-file";
    } & DriveTasksListItem);

export default function DrivePage(): ReactElement {
  const t = useTranslations("App.Drive");
  const formatter = useFormatter();
  const { data: session } = useSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [items, setItems] = useState<DriveItem[]>([]);
  const [tasksItems, setTasksItems] = useState<DriveTasksListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editingItemPath, setEditingItemPath] = useState<string | null>(null);
  const [editingItemName, setEditingItemName] = useState("");
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DriveItem | null>(null);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [snapshotFolder, setSnapshotFolder] = useState<string | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [itemToMove, setItemToMove] = useState<DriveItem | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string | null>(
    null,
  );
  const [movingItem, setMovingItem] = useState(false);
  const [allFolders, setAllFolders] = useState<DriveItem[]>([]);
  const [loadingAllFolders, setLoadingAllFolders] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [taskFileToCopy, setTaskFileToCopy] =
    useState<DriveTasksListItem | null>(null);
  const [copyDestinationScope, setCopyDestinationScope] = useState<
    "me" | "org" | null
  >(null);
  const [copying, setCopying] = useState(false);

  const loadItemsAbortRef = useRef<AbortController | null>(null);
  const loadTasksAbortRef = useRef<AbortController | null>(null);
  const fetchOrgNameAbortRef = useRef<AbortController | null>(null);

  const scopeParam = searchParams.get("scope");
  const scope: "me" | "org" = scopeParam === "org" ? "org" : "me";
  const folderParam = searchParams.get("folder") || "";
  const currentFolder = folderParam;
  const viewParam = searchParams.get("view");
  const isTasksView = viewParam === "tasks";
  const projectIdParam = searchParams.get("projectId");
  const taskIdParam = searchParams.get("taskId");
  const assigneeIdParam = searchParams.get("assigneeId");

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
    if (isTasksView) {
      return;
    }

    loadItemsAbortRef.current?.abort();
    const controller = new AbortController();
    loadItemsAbortRef.current = controller;

    setLoading(true);
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
        toast.error(t("loadFilesError"));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [
    isTasksView,
    scope,
    activeOrganizationId,
    currentFolder,
    debouncedSearchQuery,
    t,
  ]);

  const loadTasksItems = useCallback(async () => {
    if (!isTasksView) {
      return;
    }

    loadTasksAbortRef.current?.abort();
    const controller = new AbortController();
    loadTasksAbortRef.current = controller;

    setLoading(true);
    try {
      if (scope === "org" && !activeOrganizationId) {
        if (!controller.signal.aborted) {
          setTasksItems([]);
        }
        return;
      }

      const response = await getDriveTasks({
        client: getBrowserCoreClient(),
        query: {
          scope,
          ...(scope === "org" && activeOrganizationId
            ? { organizationId: activeOrganizationId }
            : {}),
          ...(projectIdParam ? { projectId: projectIdParam } : {}),
          ...(taskIdParam ? { taskId: taskIdParam } : {}),
          ...(assigneeIdParam ? { assigneeId: assigneeIdParam } : {}),
        },
        signal: controller.signal,
        throwOnError: true,
      });

      if (!controller.signal.aborted) {
        setTasksItems(response.data?.data ?? []);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error("Failed to load tasks", err);
        toast.error(t("loadTasksError"));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [
    isTasksView,
    scope,
    activeOrganizationId,
    projectIdParam,
    taskIdParam,
    assigneeIdParam,
    t,
  ]);

  useEffect(() => {
    if (isTasksView) {
      void loadTasksItems();
    } else {
      void loadItems();
    }
  }, [isTasksView, loadItems, loadTasksItems]);

  // Resolve missing project/task names from URL on refresh
  useEffect(() => {
    if (!isTasksView) {
      return;
    }

    async function resolveNames() {
      const missingProjectName =
        projectIdParam &&
        projectIdParam !== "null" &&
        !projectNames.has(projectIdParam);
      const missingTaskName = taskIdParam && !taskNames.has(taskIdParam);

      if (!missingProjectName && !missingTaskName) {
        return;
      }

      try {
        if (missingProjectName) {
          const response = await getProjects({
            client: getBrowserCoreClient(),
            query: { limit: 100 },
          });
          const projects = response.data?.data ?? [];
          const project = projects.find((p) => p.id === projectIdParam);
          if (project) {
            const newNames = new Map(projectNames);
            newNames.set(project.id, project.name);
            setProjectNames(newNames);
          }
        }

        if (missingTaskName && projectIdParam) {
          const response = await getTasks({
            client: getBrowserCoreClient(),
            query: {
              projectId: projectIdParam === "null" ? undefined : projectIdParam,
              limit: 100,
            },
          });
          const tasks = response.data?.data ?? [];
          const task = tasks.find((t) => t.id === taskIdParam);
          if (task) {
            const newNames = new Map(taskNames);
            newNames.set(task.id, task.name);
            setTaskNames(newNames);
          }
        }
      } catch (err) {
        console.error("Failed to resolve names", err);
      }
    }

    void resolveNames();
  }, [isTasksView, projectIdParam, taskIdParam, projectNames, taskNames]);

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
      if (isDuplicateResourceError(err)) {
        toast.error(t("renameConflictError"));
      } else {
        toast.error(t("renameError"));
      }
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
      toast.error(
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
    if (newScope !== "me" && newScope !== "org") {
      return;
    }
    if (newScope === scope) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", newScope);
    params.delete("folder");
    params.delete("view");
    params.delete("projectId");
    params.delete("taskId");
    params.delete("assigneeId");
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToFolder(folderName: string) {
    const params = new URLSearchParams(searchParams.toString());
    const newPath = currentFolder
      ? `${currentFolder}/${folderName}`
      : folderName;
    params.set("folder", newPath);
    params.delete("view");
    params.delete("projectId");
    params.delete("taskId");
    params.delete("assigneeId");
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToBreadcrumb(index: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (index === -1) {
      params.delete("folder");
      params.delete("view");
      params.delete("projectId");
      params.delete("taskId");
      params.delete("assigneeId");
    } else {
      const segments = currentFolder.split("/");
      const newPath = segments.slice(0, index + 1).join("/");
      params.set("folder", newPath);
      params.delete("view");
      params.delete("projectId");
      params.delete("taskId");
      params.delete("assigneeId");
    }
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToTasksRoot() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "tasks");
    params.delete("folder");
    params.delete("projectId");
    params.delete("taskId");
    params.delete("assigneeId");
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToProject(projectId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "tasks");
    params.set("projectId", projectId);
    params.delete("folder");
    params.delete("taskId");
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToTask(taskId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "tasks");
    params.set("taskId", taskId);
    params.delete("folder");
    router.push(`/drive?${params.toString()}`);
  }

  function openCreateFolderDialog() {
    setSnapshotFolder(currentFolder);
    setCreateFolderDialogOpen(true);
  }

  function closeCreateFolderDialog() {
    setCreateFolderDialogOpen(false);
    setNewFolderName("");
    setSnapshotFolder(null);
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) {
      return;
    }

    setCreatingFolder(true);
    try {
      const targetFolder = snapshotFolder ?? currentFolder;
      await postDriveFolders({
        client: getBrowserCoreClient(),
        body: {
          folderPath: targetFolder
            ? `${targetFolder}/${newFolderName.trim()}`
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
      setSnapshotFolder(null);
      await loadItems();
    } catch (err) {
      console.error("Failed to create folder", err);

      if (isDuplicateResourceError(err)) {
        setCreateFolderDialogOpen(false);
        setNewFolderName("");
        setSnapshotFolder(null);
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
    void loadAllFolders();
  }

  async function loadAllFolders() {
    setLoadingAllFolders(true);
    try {
      if (scope === "org" && !activeOrganizationId) {
        setAllFolders([]);
        return;
      }

      const loaded = await listDriveItems({
        scope,
        ...(scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
      });

      setAllFolders(loaded.filter((item) => item.type === "folder"));
    } catch (err) {
      console.error("Failed to load all folders", err);
      setAllFolders([]);
    } finally {
      setLoadingAllFolders(false);
    }
  }

  async function handleMoveConfirm() {
    if (!itemToMove || selectedDestination === null) {
      return;
    }

    setMovingItem(true);
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
      toast.error(
        itemToMove.type === "folder"
          ? t("moveFolderError")
          : t("moveFileError"),
      );
    } finally {
      setMovingItem(false);
    }
  }

  function openCopyDialog(item: DriveTasksListItem) {
    if (item.type !== "task-file") {
      return;
    }
    setTaskFileToCopy(item);
    setCopyDestinationScope(null);
    setCopyDialogOpen(true);
  }

  async function handleCopyConfirm() {
    if (
      !taskFileToCopy ||
      taskFileToCopy.type !== "task-file" ||
      !copyDestinationScope
    ) {
      return;
    }

    setCopying(true);
    try {
      await postDriveTasksCopy({
        client: getBrowserCoreClient(),
        body: {
          taskFileId: taskFileToCopy.id,
          scope: copyDestinationScope,
          ...(copyDestinationScope === "org" && activeOrganizationId
            ? { organizationId: activeOrganizationId }
            : {}),
        },
        throwOnError: true,
      });

      toast.success(t("copyToDriveSuccess"));
      setCopyDialogOpen(false);
      setTaskFileToCopy(null);
      setCopyDestinationScope(null);
    } catch (err) {
      console.error("Failed to copy file", err);
      if (isDuplicateResourceError(err)) {
        toast.error(t("copyToDriveDuplicateError"));
      } else {
        toast.error(t("copyToDriveError"));
      }
    } finally {
      setCopying(false);
    }
  }

  const breadcrumbSegments = currentFolder ? currentFolder.split("/") : [];

  const availableDestinations = (() => {
    if (!itemToMove) return [];

    const destinations: Array<{ path: string; label: string }> = [];

    if (currentFolder !== "") {
      destinations.push({ path: "", label: t("rootFolder") });
    }

    breadcrumbSegments.forEach((_, index) => {
      const ancestorPath = breadcrumbSegments.slice(0, index + 1).join("/");
      if (ancestorPath === currentFolder) {
        return;
      }
      destinations.push({
        path: ancestorPath,
        label: breadcrumbSegments.slice(0, index + 1).join(" / "),
      });
    });

    const foldersToShow = allFolders.filter((folder) => {
      const folderPath = folder.name;
      const itemPath =
        itemToMove.type === "file"
          ? itemToMove.pathname
          : currentFolder
            ? `${currentFolder}/${itemToMove.name}`
            : itemToMove.name;

      if (folderPath === itemPath) {
        return false;
      }

      if (itemToMove.type === "folder") {
        const folderPathNormalized = folder.name;
        const itemFolderPath = currentFolder
          ? `${currentFolder}/${itemToMove.name}`
          : itemToMove.name;
        if (folderPathNormalized.startsWith(`${itemFolderPath}/`)) {
          return false;
        }
      }

      return true;
    });

    foldersToShow.forEach((folder) => {
      const folderPath = folder.name;
      const segments = folderPath.split("/");
      destinations.push({
        path: folderPath,
        label: segments.join(" / "),
      });
    });

    return destinations;
  })();

  const exploreItems: ExploreItem[] = (() => {
    if (isTasksView) {
      return tasksItems.map((item) => {
        if (item.type === "project") {
          return { kind: "task-project", ...item };
        }
        if (item.type === "no-project") {
          return { kind: "task-no-project", ...item };
        }
        if (item.type === "task") {
          return { kind: "task", ...item };
        }
        return { kind: "task-file", ...item };
      });
    }

    const result: ExploreItem[] = [];
    if (currentFolder === "") {
      result.push({ kind: "tasks-root" });
    }
    return result.concat(
      items.map((item) => ({
        kind: item.type === "file" ? "blob-file" : "blob-folder",
        ...item,
      })),
    );
  })();

  const emptyState = !loading && exploreItems.length === 0;
  const hasItems = exploreItems.length > 0;

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFabOpen() {
    fileInputRef.current?.click();
  }

  const tasksBreadcrumbs = (() => {
    if (!isTasksView) {
      return [];
    }
    const crumbs: Array<{ label: string; onClick: () => void }> = [
      { label: t("tasksBreadcrumbLabel"), onClick: navigateToTasksRoot },
    ];
    if (projectIdParam) {
      const project = tasksItems.find(
        (item) => item.type === "project" && item.id === projectIdParam,
      );
      const projectName =
        project && project.type === "project"
          ? project.name
          : projectIdParam === "null"
            ? t("noProject")
            : projectIdParam;
      crumbs.push({
        label: projectName,
        onClick: () => navigateToProject(projectIdParam),
      });
    }
    if (taskIdParam) {
      const task = tasksItems.find(
        (item) => item.type === "task" && item.id === taskIdParam,
      );
      const taskName = task && task.type === "task" ? task.name : taskIdParam;
      crumbs.push({
        label: taskName,
        onClick: () => navigateToTask(taskIdParam),
      });
    }
    return crumbs;
  })();

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

            {isTasksView && (
              <DriveTasksFilters
                activeOrganizationId={activeOrganizationId}
                assigneeId={assigneeIdParam}
                projectId={projectIdParam}
                taskId={taskIdParam}
                labels={{
                  title: t("filterTitle"),
                  searchPlaceholder: t("filterSearchPlaceholder"),
                  emptyResults: t("filterEmptyResults"),
                  all: t("filterAll"),
                  coworkerLabel: t("filterCoworkerLabel"),
                  projectLabel: t("filterProjectLabel"),
                  taskLabel: t("filterTaskLabel"),
                }}
              />
            )}

            {!isTasksView && (
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
                  onClick={openCreateFolderDialog}
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
            )}
          </div>

          <nav
            className="text-muted-foreground flex items-center gap-1 overflow-x-auto text-sm"
            aria-label={t("breadcrumbNavLabel")}
          >
            <button
              type="button"
              onClick={() => navigateToBreadcrumb(-1)}
              className={cn(
                "hover:text-foreground whitespace-nowrap transition-colors",
                !isTasksView &&
                  breadcrumbSegments.length === 0 &&
                  "text-foreground font-medium",
              )}
              aria-label={
                scope === "org" && organizationName
                  ? organizationName
                  : t("myDriveTab")
              }
              title={
                scope === "org" && organizationName
                  ? organizationName
                  : t("myDriveTab")
              }
            >
              {scope === "org" ? (
                <Building2 className="size-4" aria-hidden />
              ) : (
                <Home className="size-4" aria-hidden />
              )}
            </button>
            {!isTasksView &&
              breadcrumbSegments.map((segment, index) => (
                <span key={index} className="flex shrink-0 items-center gap-1">
                  <ChevronRight className="size-4" aria-hidden />
                  <button
                    type="button"
                    onClick={() => navigateToBreadcrumb(index)}
                    className={cn(
                      "hover:text-foreground whitespace-nowrap transition-colors",
                      index === breadcrumbSegments.length - 1 &&
                        "text-foreground font-medium",
                    )}
                    title={segment}
                  >
                    {segment}
                  </button>
                </span>
              ))}
            {isTasksView &&
              tasksBreadcrumbs.map((crumb, index) => (
                <span key={index} className="flex shrink-0 items-center gap-1">
                  <ChevronRight className="size-4" aria-hidden />
                  <button
                    type="button"
                    onClick={crumb.onClick}
                    className={cn(
                      "hover:text-foreground whitespace-nowrap transition-colors",
                      index === tasksBreadcrumbs.length - 1 &&
                        "text-foreground font-medium",
                    )}
                    title={crumb.label}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
          </nav>
        </div>

        {!isTasksView && (
          <div className="mb-6 flex items-center gap-2 md:hidden">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
              <Input
                type="text"
                placeholder={t("searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full pl-8"
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={openCreateFolderDialog}
              aria-label={t("createFolder")}
            >
              <FolderPlus className="size-4" aria-hidden />
            </Button>
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
                "bg-muted/30 border-border/50 -mx-6 flex flex-col items-center justify-center overflow-hidden rounded-none border-0 py-12 text-center md:mx-0 md:rounded-xl md:border",
                PROJECTS_LIST_CARD_MIN_H_CLASS,
              )}
            >
              <div className="max-w-sm">
                <h2 className="text-foreground text-lg font-semibold">
                  {isTasksView
                    ? t("tasksEmptyTitle")
                    : searchQuery
                      ? t("noMatchTitle")
                      : t("emptyTitle")}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {isTasksView
                    ? t("tasksEmptyDescription")
                    : searchQuery
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
                {exploreItems.map((item, idx) => {
                  if (item.kind === "tasks-root") {
                    return (
                      <article
                        key="tasks-root"
                        className={cn(
                          "-mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
                          PROJECTS_LIST_ROW_LAYOUT_CLASS,
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
                          <div className="flex size-8 shrink-0 items-center justify-center">
                            <Folders className="text-primary size-5" />
                          </div>
                          <button
                            type="button"
                            onClick={navigateToTasksRoot}
                            className="text-foreground hover:text-foreground/80 min-w-0 flex-1 text-left text-sm font-medium underline-offset-2 hover:underline"
                            title={t("tasksFolder")}
                          >
                            {t("tasksFolder")}
                          </button>
                        </div>
                      </article>
                    );
                  }

                  if (item.kind === "task-project") {
                    if (!("type" in item) || item.type !== "project") {
                      return null;
                    }
                    return (
                      <article
                        key={`project-${item.id}`}
                        className={cn(
                          "-mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
                          PROJECTS_LIST_ROW_LAYOUT_CLASS,
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
                          <div className="flex size-8 shrink-0 items-center justify-center">
                            <Folder className="text-muted-foreground size-5" />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => navigateToProject(item.id)}
                              className="text-foreground hover:text-foreground/80 line-clamp-1 text-left text-sm font-medium underline-offset-2 hover:underline"
                              title={item.name}
                            >
                              {item.name}
                            </button>
                            <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                              <span>
                                {formatter.dateTime(
                                  new Date(item.latestFileUpdatedAt),
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
                          <div className="text-muted-foreground/70 hidden shrink-0 text-xs md:block">
                            <span>
                              {formatter.dateTime(
                                new Date(item.latestFileUpdatedAt),
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
                      </article>
                    );
                  }

                  if (item.kind === "task-no-project") {
                    if (!("type" in item) || item.type !== "no-project") {
                      return null;
                    }
                    return (
                      <article
                        key="no-project"
                        className={cn(
                          "-mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
                          PROJECTS_LIST_ROW_LAYOUT_CLASS,
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
                          <div className="flex size-8 shrink-0 items-center justify-center">
                            <Folder className="text-muted-foreground size-5" />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => navigateToProject("null")}
                              className="text-foreground hover:text-foreground/80 line-clamp-1 text-left text-sm font-medium underline-offset-2 hover:underline"
                              title={t("noProject")}
                            >
                              {t("noProject")}
                            </button>
                            <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                              <span>
                                {formatter.dateTime(
                                  new Date(item.latestFileUpdatedAt),
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
                          <div className="text-muted-foreground/70 hidden shrink-0 text-xs md:block">
                            <span>
                              {formatter.dateTime(
                                new Date(item.latestFileUpdatedAt),
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
                      </article>
                    );
                  }

                  if (item.kind === "task") {
                    if (!("type" in item) || item.type !== "task") {
                      return null;
                    }
                    return (
                      <article
                        key={`task-${item.id}`}
                        className={cn(
                          "-mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
                          PROJECTS_LIST_ROW_LAYOUT_CLASS,
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
                          <div className="flex size-8 shrink-0 items-center justify-center">
                            <Folder className="text-muted-foreground size-5" />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => navigateToTask(item.id)}
                              className="text-foreground hover:text-foreground/80 line-clamp-1 text-left text-sm font-medium underline-offset-2 hover:underline"
                              title={item.name}
                            >
                              {item.name}
                            </button>
                            <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                              <span>
                                {formatter.dateTime(
                                  new Date(item.latestFileUpdatedAt),
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
                          <div className="text-muted-foreground/70 hidden shrink-0 text-xs md:block">
                            <span>
                              {formatter.dateTime(
                                new Date(item.latestFileUpdatedAt),
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
                      </article>
                    );
                  }

                  if (item.kind === "task-file") {
                    if (!("type" in item) || item.type !== "task-file") {
                      return null;
                    }
                    const extension = getExtensionFromUrl(item.name);
                    const { isImage, documentKind } = classifyFilePreview(
                      item.fileUrl,
                      item.name,
                    );
                    const isPreviewable = isImage || documentKind !== null;

                    return (
                      <article
                        key={`task-file-${item.id}`}
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
                            {isPreviewable ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isImage) {
                                      // Open image viewer
                                    } else if (documentKind) {
                                      // Open document viewer
                                    }
                                  }}
                                  className="text-foreground hover:text-foreground/80 line-clamp-1 text-left text-sm font-medium underline-offset-2 hover:underline"
                                  title={item.name}
                                >
                                  {item.name}
                                </button>
                              </>
                            ) : (
                              <span
                                className="text-foreground line-clamp-1 text-sm font-medium"
                                title={item.name}
                              >
                                {item.name}
                              </span>
                            )}
                            <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                              <span>
                                {item.size ? formatBytes(item.size) : "—"}
                              </span>
                              <span>
                                {formatter.dateTime(new Date(item.updatedAt), {
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
                              {formatter.dateTime(new Date(item.updatedAt), {
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
                                onSelect={(e) => {
                                  e.preventDefault();
                                  openCopyDialog(item);
                                }}
                              >
                                <Copy className="size-4" aria-hidden />
                                {t("copyToDriveAction")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </article>
                    );
                  }

                  if (
                    item.kind === "blob-file" ||
                    item.kind === "blob-folder"
                  ) {
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
                              onChange={(e) =>
                                setEditingItemName(e.target.value)
                              }
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
                                    title={item.name}
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
                                        {item.size
                                          ? formatBytes(item.size)
                                          : "—"}
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
                                  onSelect={(e) => {
                                    e.preventDefault();
                                    startEdit(item);
                                  }}
                                  disabled={editingItemPath !== null}
                                >
                                  <Edit3 className="size-4" aria-hidden />
                                  {t("renameAction")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={(e) => {
                                    e.preventDefault();
                                    openMoveDialog(item);
                                  }}
                                  disabled={editingItemPath !== null}
                                >
                                  <Folder className="size-4" aria-hidden />
                                  {t("moveAction")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={(e) => {
                                    e.preventDefault();
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
                  }

                  return null;
                })}
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      {!isTasksView && (
        <ListMobileCreateFab
          ariaLabel={t("uploadFab")}
          onOpen={handleFabOpen}
          icon={Upload}
          progress={uploading ? uploadProgress : undefined}
        />
      )}

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
        onOpenChange={(open) => {
          if (!open) {
            closeCreateFolderDialog();
          }
        }}
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
            <Button variant="outline" onClick={closeCreateFolderDialog}>
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
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {loadingAllFolders ? (
              <p className="text-muted-foreground text-sm">
                {t("loadingFolders")}
              </p>
            ) : (
              availableDestinations.map((dest) => (
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
              ))
            )}
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

      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("selectDestinationDrive")}</DialogTitle>
            <DialogDescription>
              {t("selectDestinationDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setCopyDestinationScope("me")}
              className={cn(
                "text-foreground hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                copyDestinationScope === "me" && "bg-muted border-primary",
              )}
            >
              <Home className="text-muted-foreground size-4 shrink-0" />
              <span className="flex-1">{t("myDriveDestination")}</span>
            </button>
            {activeOrganizationId && organizationName && (
              <button
                type="button"
                onClick={() => setCopyDestinationScope("org")}
                className={cn(
                  "text-foreground hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  copyDestinationScope === "org" && "bg-muted border-primary",
                )}
              >
                <Building2 className="text-muted-foreground size-4 shrink-0" />
                <span className="flex-1">
                  {t("organizationDriveDestination", {
                    name: organizationName,
                  })}
                </span>
              </button>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCopyDialogOpen(false);
                setTaskFileToCopy(null);
                setCopyDestinationScope(null);
              }}
            >
              {t("cancelAction")}
            </Button>
            <Button
              onClick={() => void handleCopyConfirm()}
              disabled={copying || !copyDestinationScope}
            >
              {t("copyToDriveAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
