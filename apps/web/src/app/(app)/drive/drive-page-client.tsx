"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { parseAsString, useQueryStates } from "nuqs";
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
  DriveFilePreview,
  DriveItemCard,
  DriveItemName,
  driveItemActivation,
} from "@/app/drive/components/drive-item-card";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { DriveRecentsPanel } from "@/app/drive/components/drive-recents-panel";
import { DriveTasksFilters } from "@/app/drive/components/drive-tasks-filters";
import {
  DRIVE_FILE_TYPE_ICON_CLASS,
  driveItemIconWellClass,
  driveItemMetaDesktopClass,
  driveItemMetaMobileClass,
  driveItemsListClass,
  driveItemsPanelClass,
} from "@/app/drive/components/drive-view-layout";
import { DriveViewModeSwitch } from "@/app/drive/components/drive-view-mode-switch";
import {
  type DrivePrimaryView,
  DriveViewTabs,
} from "@/app/drive/components/drive-view-tabs";
import { PROJECTS_LIST_CARD_MIN_H_CLASS } from "@/app/projects/constants";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  getProjectsById,
  getTasksById,
  getUsersByIdOrganizations,
  patchDriveFilesMove,
  patchDriveFilesRename,
  patchDriveFoldersRename,
  postDriveFolders,
  postDriveTasksCopy,
} from "@/lib/clients/generated/core";
import {
  type FilesViewMode,
  serializeFilesViewModeCookie,
} from "@/lib/ui-preferences/files-view-mode";
import { cn } from "@/lib/utils";
import {
  driveStoreForActiveWorkspace,
  driveWorkspaceRootLabel,
  listDriveItems,
} from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  isDuplicateResourceError,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";
import { fetchDriveTasksPage } from "@/lib/utils/drive-tasks-list.client";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import { formatBytes } from "@/lib/utils/format-bytes";
import { DRIVE_ITEMS_QUERY_KEY, getDriveItemsQueryOptions } from "@/queries";

function withoutLegacyDriveScopeParam(
  params: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  next.delete("scope");
  return next;
}

function appendDownloadParam(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

type ExploreItem =
  | ({ kind: "blob-file" | "blob-folder" } & DriveItem)
  | { kind: "tasks-root" }
  | ({
      kind: "task-project" | "task-no-project" | "task" | "task-file";
    } & DriveTasksListItem);

interface DrivePageClientProps {
  defaultFilesViewMode: FilesViewMode;
}

interface DrivePageWorkspaceProps {
  activeOrganizationId: string | null;
  defaultFilesViewMode: FilesViewMode;
}

export function DrivePageClient({
  defaultFilesViewMode,
}: DrivePageClientProps): ReactElement {
  const { data: session } = useSession();
  // Unknown session is not personal. Hold the last known workspace so a
  // pending refetch cannot switch the list query to `{ scope: "me" }`.
  const workspaceFromSession = session
    ? (session.session.activeOrganizationId ?? null)
    : undefined;
  const workspaceIdRef = useRef(workspaceFromSession);
  if (workspaceFromSession !== undefined) {
    workspaceIdRef.current = workspaceFromSession;
  }
  const activeOrganizationId = workspaceIdRef.current;
  const router = useRouter();
  const searchParams = useSearchParams();
  const previousWorkspaceIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (activeOrganizationId === undefined) {
      return;
    }
    if (previousWorkspaceIdRef.current === undefined) {
      previousWorkspaceIdRef.current = activeOrganizationId;
      return;
    }
    if (previousWorkspaceIdRef.current === activeOrganizationId) {
      return;
    }
    previousWorkspaceIdRef.current = activeOrganizationId;
    if (
      !searchParams.get("folder") &&
      !searchParams.get("view") &&
      !searchParams.get("projectId") &&
      !searchParams.get("taskId") &&
      !searchParams.get("assigneeId")
    ) {
      return;
    }
    const params = withoutLegacyDriveScopeParam(searchParams);
    params.delete("folder");
    params.delete("view");
    params.delete("projectId");
    params.delete("taskId");
    params.delete("assigneeId");
    const query = params.toString();
    router.replace(query ? `/drive?${query}` : "/drive");
  }, [activeOrganizationId, router, searchParams]);

  if (activeOrganizationId === undefined) {
    return (
      <div className={cn("w-full px-2", LIST_MOBILE_CREATE_FAB_CLEARANCE)}>
        <DriveListSkeleton viewMode={defaultFilesViewMode} />
      </div>
    );
  }

  return (
    <DrivePageWorkspace
      activeOrganizationId={activeOrganizationId}
      defaultFilesViewMode={defaultFilesViewMode}
    />
  );
}

function DrivePageWorkspace({
  activeOrganizationId,
  defaultFilesViewMode,
}: DrivePageWorkspaceProps): ReactElement {
  const t = useTranslations("App.Drive");
  const formatter = useFormatter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [driveNavQuery, setDriveNavQuery] = useQueryStates({
    view: parseAsString,
    folder: parseAsString,
    projectId: parseAsString,
    taskId: parseAsString,
    assigneeId: parseAsString,
  });
  const pathname = usePathname();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [filesViewMode, setFilesViewMode] =
    useState<FilesViewMode>(defaultFilesViewMode);
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
  const [uiWorkspaceId, setUiWorkspaceId] = useState(activeOrganizationId);
  const [tasksItems, setTasksItems] = useState<DriveTasksListItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksNextCursor, setTasksNextCursor] = useState<string | null>(null);
  const [tasksLoadingMore, setTasksLoadingMore] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [recentsReloadToken, setRecentsReloadToken] = useState(0);
  const [taskFileToCopy, setTaskFileToCopy] =
    useState<DriveTasksListItem | null>(null);
  const [copying, setCopying] = useState(false);
  const [projectNameCache, setProjectNameCache] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [taskNameCache, setTaskNameCache] = useState<Map<string, string>>(
    () => new Map(),
  );

  const fetchOrgNameAbortRef = useRef<AbortController | null>(null);
  const loadAllFoldersAbortRef = useRef<AbortController | null>(null);
  const loadTasksAbortRef = useRef<AbortController | null>(null);
  const loadMoreTasksAbortRef = useRef<AbortController | null>(null);
  const workspaceIdRef = useRef(activeOrganizationId);
  workspaceIdRef.current = activeOrganizationId;
  const debouncedSetSearchQuery = useDebouncedCallback((value: string) => {
    setDebouncedSearchQuery(value);
  }, getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME);

  if (uiWorkspaceId !== activeOrganizationId) {
    setUiWorkspaceId(activeOrganizationId);
    setEditingItemPath(null);
    setEditingItemName("");
    setDeleteDialogOpen(false);
    setItemToDelete(null);
    setCreateFolderDialogOpen(false);
    setNewFolderName("");
    setSnapshotFolder(null);
    setMoveDialogOpen(false);
    setItemToMove(null);
    setSelectedDestination(null);
    loadAllFoldersAbortRef.current?.abort();
    setAllFolders([]);
    setLoadingAllFolders(false);
    debouncedSetSearchQuery.cancel();
    setSearchQuery("");
    setDebouncedSearchQuery("");
    loadTasksAbortRef.current?.abort();
    loadMoreTasksAbortRef.current?.abort();
    setTasksItems([]);
    setTasksLoading(false);
    setTasksNextCursor(null);
    setTasksLoadingMore(false);
    setCopyDialogOpen(false);
    setTaskFileToCopy(null);
    setProjectNameCache(new Map());
    setTaskNameCache(new Map());
  }

  const driveStore = driveStoreForActiveWorkspace(activeOrganizationId);
  const scope = driveStore.scope;
  const folderParam = driveNavQuery.folder ?? searchParams.get("folder") ?? "";
  const currentFolder = folderParam;
  const viewParam = driveNavQuery.view ?? searchParams.get("view");
  const isTasksView = viewParam === "tasks";
  const isBrowseView =
    !isTasksView && (viewParam === "browse" || folderParam.length > 0);
  const isRecentsView = !isTasksView && !isBrowseView;
  const primaryView: DrivePrimaryView =
    isBrowseView || isTasksView ? "browse" : "recents";
  const layoutMode: FilesViewMode = filesViewMode;
  const projectIdParam = searchParams.get("projectId");
  const taskIdParam = searchParams.get("taskId");
  const assigneeIdParam = searchParams.get("assigneeId");
  const previousIsTasksViewRef = useRef(isTasksView);
  if (previousIsTasksViewRef.current !== isTasksView) {
    previousIsTasksViewRef.current = isTasksView;
    debouncedSetSearchQuery.cancel();
    setSearchQuery("");
    setDebouncedSearchQuery("");
  }
  const isTasksSearchActive =
    isTasksView && debouncedSearchQuery.trim().length > 0;
  const storeRootLabel = driveWorkspaceRootLabel(driveStore, organizationName, {
    myDrive: t("myDrive"),
    organizationFallback: t("organizationDriveFallback"),
  });

  useRegisterBreadcrumbOverride({
    pathname,
    segments: [{ label: t("breadcrumb"), href: "/drive" }],
  });

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    debouncedSetSearchQuery(value);
  }

  const driveItemsQuery = useQuery({
    ...getDriveItemsQueryOptions({
      store: driveStore,
      folder: currentFolder,
      search: debouncedSearchQuery,
    }),
    enabled: isBrowseView && !isTasksView,
  });
  const items = driveItemsQuery.data ?? [];
  const loading = isRecentsView
    ? false
    : isTasksView
      ? tasksLoading
      : driveItemsQuery.isPending;

  useEffect(() => {
    if (!driveItemsQuery.isError) {
      return;
    }
    console.error("Failed to load Drive items", driveItemsQuery.error);
    toast.error(t("loadFilesError"));
  }, [driveItemsQuery.error, driveItemsQuery.isError, t]);

  async function refreshDriveItems() {
    await queryClient.invalidateQueries({ queryKey: DRIVE_ITEMS_QUERY_KEY });
  }

  const loadTasksItems = useCallback(async () => {
    if (!isTasksView) {
      return;
    }

    loadTasksAbortRef.current?.abort();
    loadMoreTasksAbortRef.current?.abort();
    loadMoreTasksAbortRef.current = null;
    setTasksLoadingMore(false);
    const controller = new AbortController();
    loadTasksAbortRef.current = controller;

    try {
      if (scope === "org" && !activeOrganizationId) {
        if (!controller.signal.aborted) {
          setTasksItems([]);
          setTasksNextCursor(null);
          setTasksLoading(false);
        }
        return;
      }

      if (!controller.signal.aborted) {
        setTasksItems([]);
        setTasksNextCursor(null);
        setTasksLoading(true);
      }

      const page = await fetchDriveTasksPage({
        scope,
        ...(scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        ...(isTasksSearchActive
          ? { q: debouncedSearchQuery.trim() }
          : taskIdParam
            ? { taskId: taskIdParam }
            : projectIdParam
              ? { projectId: projectIdParam }
              : {}),
        ...(assigneeIdParam ? { assigneeId: assigneeIdParam } : {}),
        signal: controller.signal,
      });

      if (!controller.signal.aborted) {
        setTasksItems(page.items);
        setTasksNextCursor(page.nextCursor);
        setProjectNameCache((prev) => {
          const next = new Map(prev);
          for (const item of page.items) {
            if (item.type === "project") {
              next.set(item.id, item.name);
            }
          }
          return next;
        });
        setTaskNameCache((prev) => {
          const next = new Map(prev);
          for (const item of page.items) {
            if (item.type === "task") {
              next.set(item.id, item.name);
            }
          }
          return next;
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error("Failed to load tasks", err);
        toast.error(t("loadTasksError"));
      }
    } finally {
      if (!controller.signal.aborted) {
        setTasksLoading(false);
      }
    }
  }, [
    isTasksView,
    isTasksSearchActive,
    debouncedSearchQuery,
    scope,
    activeOrganizationId,
    projectIdParam,
    taskIdParam,
    assigneeIdParam,
    t,
  ]);

  const loadMoreTasksItems = useCallback(async () => {
    if (!isTasksView || !tasksNextCursor || tasksLoadingMore) {
      return;
    }

    if (scope === "org" && !activeOrganizationId) {
      return;
    }

    loadMoreTasksAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreTasksAbortRef.current = controller;
    const workspaceIdAtRequest = workspaceIdRef.current;
    const queryAtRequest = {
      scope,
      organizationId: activeOrganizationId,
      projectId: projectIdParam,
      taskId: taskIdParam,
      assigneeId: assigneeIdParam,
      searchQuery: debouncedSearchQuery.trim(),
      cursor: tasksNextCursor,
    };

    setTasksLoadingMore(true);
    try {
      const page = await fetchDriveTasksPage({
        scope: queryAtRequest.scope,
        ...(queryAtRequest.scope === "org" && queryAtRequest.organizationId
          ? { organizationId: queryAtRequest.organizationId }
          : {}),
        ...(queryAtRequest.searchQuery
          ? { q: queryAtRequest.searchQuery }
          : queryAtRequest.taskId
            ? { taskId: queryAtRequest.taskId }
            : queryAtRequest.projectId
              ? { projectId: queryAtRequest.projectId }
              : {}),
        ...(queryAtRequest.assigneeId
          ? { assigneeId: queryAtRequest.assigneeId }
          : {}),
        cursor: queryAtRequest.cursor,
        signal: controller.signal,
      });

      const queryStillMatches =
        workspaceIdRef.current === workspaceIdAtRequest &&
        scope === queryAtRequest.scope &&
        activeOrganizationId === queryAtRequest.organizationId &&
        projectIdParam === queryAtRequest.projectId &&
        taskIdParam === queryAtRequest.taskId &&
        assigneeIdParam === queryAtRequest.assigneeId &&
        debouncedSearchQuery.trim() === queryAtRequest.searchQuery;

      if (controller.signal.aborted || !queryStillMatches) {
        return;
      }

      setTasksItems((current) => [...current, ...page.items]);
      setTasksNextCursor(page.nextCursor);
      setProjectNameCache((prev) => {
        const next = new Map(prev);
        for (const item of page.items) {
          if (item.type === "project") {
            next.set(item.id, item.name);
          }
        }
        return next;
      });
      setTaskNameCache((prev) => {
        const next = new Map(prev);
        for (const item of page.items) {
          if (item.type === "task") {
            next.set(item.id, item.name);
          }
        }
        return next;
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error("Failed to load more tasks", err);
        toast.error(t("loadMoreTasksError"));
      }
    } finally {
      if (!controller.signal.aborted) {
        setTasksLoadingMore(false);
      }
    }
  }, [
    isTasksView,
    tasksNextCursor,
    tasksLoadingMore,
    scope,
    activeOrganizationId,
    projectIdParam,
    taskIdParam,
    assigneeIdParam,
    debouncedSearchQuery,
    t,
  ]);

  useEffect(() => {
    if (isTasksView) {
      void loadTasksItems();
    }
  }, [isTasksView, loadTasksItems]);

  useEffect(() => {
    if (!isTasksView) {
      return;
    }

    async function fetchMissingNames() {
      try {
        if (
          projectIdParam &&
          projectIdParam !== "null" &&
          !projectNameCache.has(projectIdParam) &&
          !tasksItems.some(
            (item) => item.type === "project" && item.id === projectIdParam,
          )
        ) {
          const response = await getProjectsById({
            client: getBrowserCoreClient(),
            path: { id: projectIdParam },
            throwOnError: true,
          });
          const project = response.data?.data;
          if (project?.id && project?.name) {
            setProjectNameCache((prev) => {
              const next = new Map(prev);
              next.set(project.id, project.name);
              return next;
            });
          }
        }

        if (
          taskIdParam &&
          !taskNameCache.has(taskIdParam) &&
          !tasksItems.some(
            (item) => item.type === "task" && item.id === taskIdParam,
          )
        ) {
          const response = await getTasksById({
            client: getBrowserCoreClient(),
            path: { id: taskIdParam },
            throwOnError: true,
          });
          const task = response.data?.data;
          if (task?.id && task?.name) {
            setTaskNameCache((prev) => {
              const next = new Map(prev);
              next.set(task.id, task.name);
              return next;
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch missing names", err);
      }
    }

    void fetchMissingNames();
  }, [isTasksView, projectIdParam, taskIdParam, tasksItems]);

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

  useEffect(() => {
    return () => {
      loadAllFoldersAbortRef.current?.abort();
    };
  }, [activeOrganizationId]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      await uploadDriveFile(file, {
        ...driveStore,
        ...(currentFolder ? { folder: currentFolder } : {}),
        onUploadProgress: (progress) => {
          setUploadProgress(progress.percentage);
        },
      });

      await refreshDriveItems();
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
            ...driveStore,
          },
          throwOnError: true,
        });
      }

      setEditingItemPath(null);
      setEditingItemName("");
      await refreshDriveItems();
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
            ...driveStore,
          },
          throwOnError: true,
        });
      }

      setDeleteDialogOpen(false);
      setItemToDelete(null);
      await refreshDriveItems();
      setRecentsReloadToken((token) => token + 1);
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

  function navigateToFolder(folderName: string) {
    const params = withoutLegacyDriveScopeParam(searchParams);
    const newPath = currentFolder
      ? `${currentFolder}/${folderName}`
      : folderName;
    params.set("folder", newPath);
    params.set("view", "browse");
    params.delete("projectId");
    params.delete("taskId");
    params.delete("assigneeId");
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToBreadcrumb(index: number) {
    const params = withoutLegacyDriveScopeParam(searchParams);
    if (index === -1) {
      params.delete("folder");
      params.set("view", "browse");
      params.delete("projectId");
      params.delete("taskId");
      params.delete("assigneeId");
    } else {
      const segments = currentFolder.split("/");
      const newPath = segments.slice(0, index + 1).join("/");
      params.set("folder", newPath);
      params.set("view", "browse");
      params.delete("projectId");
      params.delete("taskId");
      params.delete("assigneeId");
    }
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToPrimaryView(view: DrivePrimaryView) {
    void setDriveNavQuery(
      {
        view: view === "recents" ? null : "browse",
        folder: null,
        projectId: null,
        taskId: null,
        assigneeId: null,
      },
      { history: "push" },
    );
  }

  function navigateToTasksRoot() {
    const params = withoutLegacyDriveScopeParam(searchParams);
    params.set("view", "tasks");
    params.delete("folder");
    params.delete("projectId");
    params.delete("taskId");
    params.delete("assigneeId");
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToProject(projectId: string, projectName?: string) {
    if (projectName) {
      setProjectNameCache((prev) => {
        const next = new Map(prev);
        next.set(projectId, projectName);
        return next;
      });
    }
    const params = withoutLegacyDriveScopeParam(searchParams);
    params.set("view", "tasks");
    params.set("projectId", projectId);
    params.delete("folder");
    params.delete("taskId");
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToTask(taskId: string, taskName?: string) {
    if (taskName) {
      setTaskNameCache((prev) => {
        const next = new Map(prev);
        next.set(taskId, taskName);
        return next;
      });
    }
    const params = withoutLegacyDriveScopeParam(searchParams);
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
      const result = await postDriveFolders({
        client: getBrowserCoreClient(),
        body: {
          folderPath: targetFolder
            ? `${targetFolder}/${newFolderName.trim()}`
            : newFolderName.trim(),
          ...driveStore,
        },
        throwOnError: false,
      });

      // Check for error response
      if (result.error || !result.response?.ok) {
        const status = result.response?.status;
        // HTTP 409 = conflict (duplicate or reserved folder name)
        if (status === 409) {
          setCreateFolderDialogOpen(false);
          setNewFolderName("");
          setSnapshotFolder(null);
          toast.error(t("createFolderDuplicateError"));
        } else {
          toast.error(t("createFolderError"));
        }
        return;
      }

      setCreateFolderDialogOpen(false);
      setNewFolderName("");
      setSnapshotFolder(null);
      await refreshDriveItems();
    } catch (err) {
      console.error("Failed to create folder", err);
      toast.error(t("createFolderError"));
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
    loadAllFoldersAbortRef.current?.abort();
    const controller = new AbortController();
    loadAllFoldersAbortRef.current = controller;
    const requestedWorkspaceId = activeOrganizationId;
    setLoadingAllFolders(true);
    try {
      const loaded = await listDriveItems({
        ...driveStore,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        workspaceIdRef.current !== requestedWorkspaceId
      ) {
        return;
      }

      setAllFolders(loaded.filter((item) => item.type === "folder"));
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      console.error("Failed to load all folders", err);
      if (workspaceIdRef.current === requestedWorkspaceId) {
        setAllFolders([]);
      }
    } finally {
      if (
        !controller.signal.aborted &&
        workspaceIdRef.current === requestedWorkspaceId
      ) {
        setLoadingAllFolders(false);
      }
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
          ...(itemToMove.type === "folder" ? driveStore : {}),
        },
        throwOnError: true,
      });

      setMoveDialogOpen(false);
      setItemToMove(null);
      setSelectedDestination(null);
      await refreshDriveItems();
      setRecentsReloadToken((token) => token + 1);
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
    setCopyDialogOpen(true);
  }

  async function handleCopyConfirm() {
    if (!taskFileToCopy || taskFileToCopy.type !== "task-file") {
      return;
    }

    setCopying(true);
    try {
      await postDriveTasksCopy({
        client: getBrowserCoreClient(),
        body: {
          taskFileId: taskFileToCopy.id,
          scope: driveStore.scope,
          ...(driveStore.scope === "org"
            ? { organizationId: driveStore.organizationId }
            : {}),
        },
        throwOnError: true,
      });

      toast.success(t("copyToFilesSuccess"));
      setCopyDialogOpen(false);
      setTaskFileToCopy(null);
      await refreshDriveItems();
    } catch (err) {
      console.error("Failed to copy file", err);
      if (isDuplicateResourceError(err)) {
        toast.error(t("copyToFilesDuplicateError"));
      } else {
        toast.error(t("copyToFilesError"));
      }
    } finally {
      setCopying(false);
    }
  }

  const breadcrumbSegments = currentFolder ? currentFolder.split("/") : [];

  const availableDestinations = (() => {
    if (!itemToMove) return [];

    const destinations: Array<{ path: string; label: string }> = [];

    // Only include Root if not already at root
    if (currentFolder !== "") {
      destinations.push({ path: "", label: t("rootFolder") });
    }

    breadcrumbSegments.forEach((_, index) => {
      const ancestorPath = breadcrumbSegments.slice(0, index + 1).join("/");
      // Skip currentFolder itself—can't move to where it already is
      if (ancestorPath === currentFolder) {
        return;
      }
      destinations.push({
        path: ancestorPath,
        label: breadcrumbSegments.slice(0, index + 1).join(" / "),
      });
    });

    // Use allFolders (loaded on dialog open) instead of items (current folder only)
    // to enable cross-branch moves
    const foldersToShow = allFolders.filter((folder) => {
      // Exclude the item being moved
      const folderPath = folder.name;
      const itemPath =
        itemToMove.type === "file"
          ? itemToMove.pathname
          : currentFolder
            ? `${currentFolder}/${itemToMove.name}`
            : itemToMove.name;

      // Basic exclusion: don't show the item being moved
      if (folderPath === itemPath) {
        return false;
      }

      // For folders, exclude descendants to prevent moving into own subtree
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
      // Build a readable label from the folder path
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
      const trimmedSearch = debouncedSearchQuery.trim();
      const tasksLabel = t("tasksFolder");
      const showTasksRoot =
        trimmedSearch.length === 0 ||
        tasksLabel.toLowerCase().includes(trimmedSearch.toLowerCase());
      if (showTasksRoot) {
        result.push({ kind: "tasks-root" });
      }
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
      const cachedName = projectNameCache.get(projectIdParam);
      const projectName =
        project && project.type === "project"
          ? project.name
          : cachedName ||
            (projectIdParam === "null" ? t("noProject") : projectIdParam);
      crumbs.push({
        label: projectName,
        onClick: () => navigateToProject(projectIdParam),
      });
    }
    if (taskIdParam) {
      const task = tasksItems.find(
        (item) => item.type === "task" && item.id === taskIdParam,
      );
      const cachedName = taskNameCache.get(taskIdParam);
      const taskName =
        task && task.type === "task" ? task.name : cachedName || taskIdParam;
      crumbs.push({
        label: taskName,
        onClick: () => navigateToTask(taskIdParam),
      });
    }
    return crumbs;
  })();

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFabOpen() {
    fileInputRef.current?.click();
  }

  const driveTasksFilterLabels = {
    title: t("filterTitle"),
    searchPlaceholder: t("filterSearchPlaceholder"),
    emptyResults: t("filterEmptyResults"),
    all: t("filterAll"),
    coworkerLabel: t("filterCoworkerLabel"),
    projectLabel: t("filterProjectLabel"),
    taskLabel: t("filterTaskLabel"),
    noProjectLabel: t("noProject"),
    loadMore: t("loadMore"),
  };

  function handleFilesViewModeChange(next: FilesViewMode) {
    setFilesViewMode(next);
    document.cookie = serializeFilesViewModeCookie(next);
  }

  const filesViewModeSwitch = (
    <DriveViewModeSwitch
      value={filesViewMode}
      onChange={handleFilesViewModeChange}
      labels={{
        list: t("viewList"),
        grid: t("viewGrid"),
      }}
    />
  );

  return (
    <div className={cn("w-full px-2", LIST_MOBILE_CREATE_FAB_CLEARANCE)}>
      <div className="mb-4 flex flex-col gap-4 md:mb-6">
        <DriveViewTabs
          activeView={primaryView}
          browseLabel={storeRootLabel}
          onViewChange={navigateToPrimaryView}
        />
        <div className="flex items-center justify-end gap-4">
          {isTasksView && (
            <>
              <div className="hidden items-center gap-2 md:flex">
                <div className="relative">
                  <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                  <Input
                    type="text"
                    placeholder={t("tasksSearchPlaceholder")}
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="w-64 pl-8"
                  />
                </div>
              </div>
              <div className="hidden md:block">
                <DriveTasksFilters
                  activeOrganizationId={activeOrganizationId}
                  assigneeId={assigneeIdParam}
                  projectId={projectIdParam}
                  taskId={taskIdParam}
                  labels={driveTasksFilterLabels}
                />
              </div>
            </>
          )}
          {!isTasksView && isBrowseView && (
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
          {!isTasksView && isRecentsView && (
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
            </div>
          )}
          {filesViewModeSwitch}
        </div>

        {!isTasksView && isBrowseView ? (
          <nav
            className="text-muted-foreground flex items-center gap-1 overflow-x-auto text-sm"
            aria-label={t("breadcrumbNavLabel")}
          >
            <button
              type="button"
              onClick={() => navigateToBreadcrumb(-1)}
              className={cn(
                "hover:text-foreground inline-flex items-center whitespace-nowrap transition-colors",
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
          </nav>
        ) : null}
        {isTasksView ? (
          <nav
            className="text-muted-foreground flex items-center gap-1 overflow-x-auto text-sm"
            aria-label={t("breadcrumbNavLabel")}
          >
            <button
              type="button"
              onClick={() => navigateToBreadcrumb(-1)}
              className="hover:text-foreground inline-flex items-center whitespace-nowrap transition-colors"
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
            {tasksBreadcrumbs.map((crumb, index) => (
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
        ) : null}
      </div>

      {isTasksView && (
        <div className="mb-6 flex items-center gap-2 md:hidden">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              type="text"
              placeholder={t("tasksSearchPlaceholder")}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-8"
            />
          </div>
          <DriveTasksFilters
            activeOrganizationId={activeOrganizationId}
            assigneeId={assigneeIdParam}
            projectId={projectIdParam}
            taskId={taskIdParam}
            labels={driveTasksFilterLabels}
          />
        </div>
      )}

      {!isTasksView && isBrowseView && (
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

      {!isTasksView && isRecentsView && (
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
        </div>
      )}

      {isRecentsView ? (
        <DriveRecentsPanel
          driveStore={driveStore}
          activeOrganizationId={activeOrganizationId}
          searchQuery={debouncedSearchQuery}
          reloadToken={recentsReloadToken}
          viewMode={filesViewMode}
          onOpenMoveDialog={openMoveDialog}
          onOpenDeleteDialog={openDeleteDialog}
          onRenameFile={handleRename}
          onOpenCopyDialog={(item) => {
            setTaskFileToCopy({
              type: "task-file",
              id: item.taskFileId,
              name: item.name,
              fileUrl: item.fileUrl,
              size: item.size,
              mimeType: null,
              updatedAt: item.activityAt,
            });
            setCopyDialogOpen(true);
          }}
          onItemsChanged={() => {
            void refreshDriveItems();
          }}
        />
      ) : loading ? (
        <DriveListSkeleton viewMode={layoutMode} />
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
                ? searchQuery
                  ? t("tasksNoMatchTitle")
                  : t("tasksEmptyTitle")
                : searchQuery
                  ? t("noMatchTitle")
                  : t("emptyTitle")}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {isTasksView
                ? searchQuery
                  ? t("tasksNoMatchDescription")
                  : t("tasksEmptyDescription")
                : searchQuery
                  ? t("noMatchDescription")
                  : t("emptyDescription")}
            </p>
          </div>
        </div>
      ) : hasItems ? (
        <div
          className={driveItemsPanelClass(layoutMode)}
          data-testid={
            layoutMode === "grid" ? "files-layout-grid" : "files-layout-list"
          }
        >
          <div className={driveItemsListClass(layoutMode)}>
            {exploreItems.map((item) => {
              if (item.kind === "tasks-root") {
                return (
                  <DriveItemCard
                    key="tasks-root"
                    viewMode={layoutMode}
                    activateLabel={t("tasksFolder")}
                    onActivate={navigateToTasksRoot}
                  >
                    <div className={driveItemIconWellClass(layoutMode)}>
                      <Folders className="text-primary size-5" />
                    </div>
                    <DriveItemName
                      name={t("tasksFolder")}
                      className="min-w-0 flex-1"
                    />
                  </DriveItemCard>
                );
              }

              if (item.kind === "task-project" && item.type === "project") {
                return (
                  <DriveItemCard
                    key={`project-${item.id}`}
                    viewMode={layoutMode}
                    activateLabel={item.name}
                    onActivate={() => navigateToProject(item.id, item.name)}
                  >
                    <div className={driveItemIconWellClass(layoutMode)}>
                      <Folder className="text-muted-foreground size-5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <DriveItemName name={item.name} />
                      <div className={driveItemMetaMobileClass(layoutMode)}>
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
                    <div className={driveItemMetaDesktopClass(layoutMode)}>
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
                  </DriveItemCard>
                );
              }

              if (
                item.kind === "task-no-project" &&
                item.type === "no-project"
              ) {
                return (
                  <DriveItemCard
                    key="no-project"
                    viewMode={layoutMode}
                    activateLabel={t("noProject")}
                    onActivate={() => navigateToProject("null")}
                  >
                    <div className={driveItemIconWellClass(layoutMode)}>
                      <Folder className="text-muted-foreground size-5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <DriveItemName name={t("noProject")} />
                      <div className={driveItemMetaMobileClass(layoutMode)}>
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
                    <div className={driveItemMetaDesktopClass(layoutMode)}>
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
                  </DriveItemCard>
                );
              }

              if (item.kind === "task" && item.type === "task") {
                return (
                  <DriveItemCard
                    key={`task-${item.id}`}
                    viewMode={layoutMode}
                    activateLabel={item.name}
                    onActivate={() => navigateToTask(item.id, item.name)}
                  >
                    <div className={driveItemIconWellClass(layoutMode)}>
                      <Folder className="text-muted-foreground size-5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <DriveItemName name={item.name} />
                      <div className={driveItemMetaMobileClass(layoutMode)}>
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
                    <div className={driveItemMetaDesktopClass(layoutMode)}>
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
                  </DriveItemCard>
                );
              }

              if (item.kind === "task-file" && item.type === "task-file") {
                const extension = getExtensionFromUrl(item.name);
                const { isImage, documentKind } = classifyFilePreview(
                  item.fileUrl,
                  item.name,
                );
                const searchContext =
                  item.taskName != null
                    ? [
                        item.taskName,
                        item.projectName ??
                          (item.projectId === null ? t("noProject") : null),
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : null;

                return (
                  <DriveFilePreview
                    key={`task-file-${item.id}`}
                    name={item.name}
                    fileUrl={item.fileUrl}
                    isImage={isImage}
                    documentKind={documentKind}
                  >
                    {({ activate, nameEl, viewers }) => (
                      <DriveItemCard
                        viewMode={layoutMode}
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
                                {t("copyToFilesAction")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        }
                      >
                        <div className={driveItemIconWellClass(layoutMode)}>
                          <div className={DRIVE_FILE_TYPE_ICON_CLASS}>
                            <FileTypeIcon extension={extension || "file"} />
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          {nameEl}
                          {searchContext && layoutMode !== "grid" ? (
                            <p className="text-muted-foreground/70 line-clamp-1 text-xs">
                              {searchContext}
                            </p>
                          ) : null}
                          <div className={driveItemMetaMobileClass(layoutMode)}>
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
                        <div className={driveItemMetaDesktopClass(layoutMode)}>
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
                        {viewers}
                      </DriveItemCard>
                    )}
                  </DriveFilePreview>
                );
              }

              if (item.kind !== "blob-file" && item.kind !== "blob-folder") {
                return null;
              }

              const itemKey =
                item.type === "file" ? item.pathname : `folder:${item.name}`;
              const isEditing =
                (item.type === "file" && editingItemPath === item.pathname) ||
                (item.type === "folder" && editingItemPath === item.name);

              const extension =
                item.type === "file" ? getExtensionFromUrl(item.name) : null;
              const { isImage, documentKind } =
                item.type === "file"
                  ? classifyFilePreview(item.fileUrl, item.name)
                  : { isImage: false, documentKind: null };

              const blobActions = isEditing ? (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRename(item, editingItemName)}
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
                      <MoreHorizontal className="size-4" aria-hidden />
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
              );

              if (item.type === "folder") {
                return (
                  <DriveItemCard
                    key={itemKey}
                    viewMode={layoutMode}
                    {...driveItemActivation(
                      isEditing ? undefined : () => navigateToFolder(item.name),
                      item.name,
                    )}
                    actions={blobActions}
                  >
                    <div className={driveItemIconWellClass(layoutMode)}>
                      <Folder className="text-muted-foreground size-5" />
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
                      <DriveItemName
                        name={item.name}
                        className="min-w-0 flex-1"
                      />
                    )}
                  </DriveItemCard>
                );
              }

              return (
                <DriveFilePreview
                  key={itemKey}
                  name={item.name}
                  fileUrl={item.fileUrl}
                  isImage={isImage}
                  documentKind={documentKind}
                >
                  {({ activate, nameEl, viewers }) => (
                    <DriveItemCard
                      viewMode={layoutMode}
                      {...driveItemActivation(
                        isEditing ? undefined : activate,
                        item.name,
                      )}
                      actions={blobActions}
                    >
                      <div className={driveItemIconWellClass(layoutMode)}>
                        <div className={DRIVE_FILE_TYPE_ICON_CLASS}>
                          <FileTypeIcon extension={extension || "file"} />
                        </div>
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
                            {nameEl}
                            <div
                              className={driveItemMetaMobileClass(layoutMode)}
                            >
                              <span>
                                {item.size ? formatBytes(item.size) : "—"}
                              </span>
                              <span>
                                {formatter.dateTime(new Date(item.uploadedAt), {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          </div>
                          <div
                            className={driveItemMetaDesktopClass(layoutMode)}
                          >
                            <span>
                              {item.size ? formatBytes(item.size) : "—"}
                            </span>
                            <span>
                              {formatter.dateTime(new Date(item.uploadedAt), {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          {viewers}
                        </>
                      )}
                    </DriveItemCard>
                  )}
                </DriveFilePreview>
              );
            })}
            {isTasksView && tasksNextCursor ? (
              <div className="flex justify-center py-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadMoreTasksItems()}
                  disabled={tasksLoadingMore}
                >
                  {t("loadMore")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {!isTasksView && isBrowseView && (
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

      <AlertDialog
        open={copyDialogOpen}
        onOpenChange={(open) => {
          setCopyDialogOpen(open);
          if (!open) {
            setTaskFileToCopy(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("copyToFilesDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("copyToFilesDialogDescription", {
                fileName:
                  taskFileToCopy?.type === "task-file"
                    ? taskFileToCopy.name
                    : "",
                workspace: storeRootLabel,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={copying}>
              {t("deleteDialogCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={copying}
              onClick={(event) => {
                event.preventDefault();
                void handleCopyConfirm();
              }}
            >
              {t("copyToFilesDialogConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
