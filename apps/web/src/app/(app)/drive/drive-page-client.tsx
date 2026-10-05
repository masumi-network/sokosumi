"use client";

import type { DriveItem, DriveTasksListItem } from "@sokosumi/core-client";
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
} from "@sokosumi/core-client";
import { getExtensionFromUrl } from "@sokosumi/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderInput,
  FolderPlus,
  Folders,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { DriveAllFilesPanel } from "@/app/drive/components/drive-all-files-panel";
import {
  DriveFilePreview,
  DriveItemCard,
  DriveItemName,
  driveItemActivation,
} from "@/app/drive/components/drive-item-card";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { DriveRecentsPanel } from "@/app/drive/components/drive-recents-panel";
import {
  DriveSortControl,
  DriveSortMenuItems,
} from "@/app/drive/components/drive-sort-control";
import { DriveTablesFilters } from "@/app/drive/components/drive-tables-filters";
import { DriveTasksFilters } from "@/app/drive/components/drive-tasks-filters";
import {
  DRIVE_FILE_TYPE_ICON_CLASS,
  DRIVE_HEADER_CONTROL_CLASS,
  driveItemIconWellClass,
  driveItemMetaDesktopClass,
  driveItemMetaMobileClass,
  driveItemsListClass,
  driveItemsPanelClass,
} from "@/app/drive/components/drive-view-layout";
import {
  type DrivePrimaryView,
  DriveViewTabs,
} from "@/app/drive/components/drive-view-tabs";
import { TableCreateDialog } from "@/app/drive/tables/table-create-dialog";
import { TableList } from "@/app/drive/tables/table-list";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListGridViewSwitch } from "@/components/ui/list-grid-view-switch";
import { getEnvPublicConfig } from "@/config/env.public";
import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSession } from "@/lib/auth/auth.client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import {
  effectiveFilesViewMode,
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
import type { FileStore } from "@/lib/utils/file-search.client";
import {
  FILES_SORT_BY_VALUES,
  FILES_SORT_ORDER_VALUES,
  type FilesSortSelection,
  filesSortUrlValues,
  parseFilesSortSelection,
  toDriveListSortQuery,
} from "@/lib/utils/files-sort";
import { formatBytes } from "@/lib/utils/format-bytes";
import {
  DRIVE_ITEMS_QUERY_KEY,
  getDriveItemsQueryOptions,
} from "@/queries/drive";

const filesSortByParser = parseAsStringLiteral([...FILES_SORT_BY_VALUES]);
const filesSortOrderParser = parseAsStringLiteral([...FILES_SORT_ORDER_VALUES]);

function withoutLegacyDriveScopeParam(
  params: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  next.delete("scope");
  return next;
}

/**
 * The query a drive navigation should carry forward.
 *
 * Drops the legacy `scope`, and `archived` — which only the Tables list reads.
 * Every caller here rebuilds the query from the current URL and then navigates
 * into browse or tasks, so without this a `?archived=true` left over from the
 * Tables tab rides along into views that ignore it and ends up in shared links.
 * `navigateToPrimaryView` clears it through nuqs for the same reason.
 */
function driveNavParams(params: URLSearchParams): URLSearchParams {
  const next = withoutLegacyDriveScopeParam(params);
  next.delete("archived");
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
  const isMobile = useIsMobile();
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
  const skeletonViewMode = effectiveFilesViewMode(
    defaultFilesViewMode,
    isMobile,
  );

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
    const params = driveNavParams(searchParams);
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
      <div className={cn("w-full", LIST_MOBILE_CREATE_FAB_CLEARANCE)}>
        <DriveListSkeleton viewMode={skeletonViewMode} />
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
    sortBy: filesSortByParser,
    sortOrder: filesSortOrderParser,
    archived: parseAsBoolean.withDefault(false),
  });
  const pathname = usePathname();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [filesViewMode, setFilesViewMode] =
    useState<FilesViewMode>(defaultFilesViewMode);
  const isMobile = useIsMobile();
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DriveItem | null>(null);
  /**
   * Which folder is narrowing the catalog, if any.
   *
   * Folder rename, move and delete used to live on the folder cards in the grid
   * the catalog replaced, and nowhere else in the product. They are in the page
   * head's actions menu now and they act on this — so the catalog reports its
   * facet up rather than the page reading the URL, which the reader changes from
   * inside the filter sheet without the URL being involved.
   *
   * Seeded from `?folder=` so a deep link arrives with the facet applied.
   */
  const [facetFolder, setFacetFolder] = useState(
    () => searchParams.get("folder") ?? "",
  );
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
  const [catalogReloadToken, setCatalogReloadToken] = useState(0);
  const [tasksFilterSheetOpen, setTasksFilterSheetOpen] = useState(false);
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
    // Another workspace's folder cannot go on narrowing this one's catalog.
    setFacetFolder("");
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
  /**
   * A `?folder=` the reader arrived at rather than applied: Back, Forward, or a
   * link pasted into a tab that is already open.
   *
   * The catalog follows the URL on its own, and the page head did not, so Back
   * out of a folder left the chip gone from the list and Delete folder still in
   * the menu, pointed at the folder that was no longer narrowing anything.
   * Found by driving a preview.
   *
   * After the workspace-switch reset above rather than before it: that reset
   * clears the facet deliberately, and the ref will already hold this value, so
   * the two cannot fight.
   */
  const previousFolderParamRef = useRef(folderParam);
  if (previousFolderParamRef.current !== folderParam) {
    previousFolderParamRef.current = folderParam;
    setFacetFolder(folderParam);
  }
  /**
   * The folder this page is scoped to: where an upload lands and where a new
   * folder is created.
   *
   * It is the applied facet, not a place the reader has navigated into. There is
   * no navigation left on this tab — `?folder=` seeds the facet and the filter
   * sheet changes it — so this follows the catalog rather than the URL.
   */
  const currentFolder = facetFolder;
  const viewParam = driveNavQuery.view ?? searchParams.get("view");
  const isTablesView = viewParam === "tables";
  const tablesArchived = driveNavQuery.archived;
  const isTasksView = viewParam === "tasks";
  /**
   * One tab, and it is the catalog.
   *
   * `all` held the searchable catalog and `browse` held the folder tree, as two
   * tabs over the same files. Both URLs still land here — links to each
   * shipped, including global search's "See all files" and the file detail
   * page's back link — and `workspace` is the value the tab now writes.
   *
   * A bare `?folder=` still counts, so a folder deep link opens the Workspace
   * tab rather than silently falling through to Recents.
   */
  const isWorkspaceView =
    !isTablesView &&
    !isTasksView &&
    (viewParam === "workspace" ||
      viewParam === "all" ||
      viewParam === "browse" ||
      folderParam.length > 0);
  /**
   * The Workspace tab is the catalog, and nothing else.
   *
   * It used to be the catalog *and* a folder grid, with the grid first and the
   * catalog below it: two navigation models on one screen, the search box
   * roughly mid-page, and the first file row below the fold on a list of ten
   * files. A folder is a facet inside the catalog now — `?folder=` pre-applies
   * it — so there is no root and no depth here, only one list.
   */
  const isRecentsView = !isTablesView && !isTasksView && !isWorkspaceView;
  const primaryView: DrivePrimaryView = isTablesView
    ? "tables"
    : isWorkspaceView || isTasksView
      ? "workspace"
      : "recents";
  /**
   * One stable object for the All files panel.
   *
   * It used to be an inline literal, so its identity changed on every
   * render of this page — upload progress, the tasks-view search box, a
   * dialog opening. The panel memoises its search on the store, so each of
   * those re-ran the search and cleared the reader's bulk selection
   * mid-edit.
   */
  const allFilesOrganizationId =
    driveStore.scope === "org" ? driveStore.organizationId : null;
  const allFilesStore = useMemo<FileStore>(
    () =>
      allFilesOrganizationId
        ? { scope: "org", organizationId: allFilesOrganizationId }
        : { scope: "me" },
    [allFilesOrganizationId],
  );

  const filesSortSelection = parseFilesSortSelection(
    driveNavQuery.sortBy,
    driveNavQuery.sortOrder,
  );
  const filesSortQuery = toDriveListSortQuery(filesSortSelection);
  const layoutMode: FilesViewMode = effectiveFilesViewMode(
    filesViewMode,
    isMobile,
  );
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

  /**
   * Still fetched, and no longer rendered as a list.
   *
   * The Workspace tab shows the catalog, which lists files from the index
   * rather than from the blob store. This listing is what the move dialog's
   * destinations and the folder actions read, and what an upload invalidates,
   * so it stays — it just stopped being a second list on the page.
   */
  const driveItemsQuery = useQuery({
    ...getDriveItemsQueryOptions({
      store: driveStore,
      folder: currentFolder,
      search: debouncedSearchQuery,
      ...filesSortQuery,
    }),
    enabled: isWorkspaceView && !isTasksView,
  });
  // The catalog renders its own skeleton, so the Workspace tab never uses this.
  const loading = isTasksView ? tasksLoading : false;

  useEffect(() => {
    if (!driveItemsQuery.isError) {
      return;
    }
    console.error("Failed to load Drive items", driveItemsQuery.error);
    toast.error(t("loadFilesError"));
  }, [driveItemsQuery.error, driveItemsQuery.isError, t]);

  async function refreshDriveItems() {
    await queryClient.invalidateQueries({ queryKey: DRIVE_ITEMS_QUERY_KEY });
    /**
     * And the catalog, which is the list a reader on this tab is looking at.
     *
     * It fetches from the search index rather than from the blob listing, so
     * invalidating that query does not touch it. Before the merge an upload
     * refreshed the grid the reader could see; without this it would land in
     * the store and appear nowhere until they searched for something.
     */
    setCatalogReloadToken((token) => token + 1);
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
        ...filesSortQuery,
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
    filesSortQuery.sortBy,
    filesSortQuery.sortOrder,
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
      sortBy: filesSortQuery.sortBy,
      sortOrder: filesSortQuery.sortOrder,
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
        ...(queryAtRequest.sortBy ? { sortBy: queryAtRequest.sortBy } : {}),
        ...(queryAtRequest.sortOrder
          ? { sortOrder: queryAtRequest.sortOrder }
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
        debouncedSearchQuery.trim() === queryAtRequest.searchQuery &&
        filesSortQuery.sortBy === queryAtRequest.sortBy &&
        filesSortQuery.sortOrder === queryAtRequest.sortOrder;

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
    filesSortQuery.sortBy,
    filesSortQuery.sortOrder,
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
            /**
             * `item.name` is the folder's whole path.
             *
             * It used to be a single segment relative to the folder being
             * listed, and the listing is gone — the only folder these actions
             * ever hold now is the applied facet. The new path keeps the old
             * one's parent, so renaming `Media/Youtube` to `Shorts` produces
             * `Media/Shorts` rather than moving it to the root.
             */
            oldFolderPath: item.name,
            newFolderPath: `${item.name.slice(
              0,
              item.name.lastIndexOf("/") + 1,
            )}${newName.trim()}`,
            ...driveStore,
          },
          throwOnError: true,
        });
      }

      // The facet follows the folder it is narrowing to, or the catalog is
      // filtered to a path that no longer exists and reads as empty.
      if (item.type === "folder") {
        applyFolderFacet(
          `${item.name.slice(0, item.name.lastIndexOf("/") + 1)}${newName.trim()}`,
        );
      }
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
            // The whole path, as above.
            folderPath: itemToDelete.name,
            ...driveStore,
          },
          throwOnError: true,
        });
      }

      setDeleteDialogOpen(false);
      // A deleted folder cannot go on narrowing the catalog.
      if (itemToDelete.type === "folder") applyFolderFacet("");
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

  /**
   * Back to the whole catalog, from the tasks trail.
   *
   * This was `navigateToBreadcrumb(index)` over a folder path. Folders are a
   * facet inside the catalog now and there is no trail to walk, so the only
   * crumb left is the root one the tasks view keeps at every depth — its tab is
   * the workspace tab, already selected, so nothing else leaves the tasks list.
   */
  function navigateToWorkspaceRoot() {
    const params = driveNavParams(searchParams);
    params.delete("folder");
    params.set("view", "workspace");
    params.delete("projectId");
    params.delete("taskId");
    params.delete("assigneeId");
    router.push(`/drive?${params.toString()}`);
  }

  function navigateToPrimaryView(view: DrivePrimaryView) {
    void setDriveNavQuery(
      {
        view: view === "recents" ? null : view,
        folder: null,
        projectId: null,
        taskId: null,
        assigneeId: null,
        archived: null,
      },
      { history: "push" },
    );
  }

  function navigateToTasksRoot() {
    const params = driveNavParams(searchParams);
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
    const params = driveNavParams(searchParams);
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
    const params = driveNavParams(searchParams);
    params.set("view", "tasks");
    params.set("taskId", taskId);
    params.delete("folder");
    router.push(`/drive?${params.toString()}`);
  }

  /**
   * Point both the URL and the catalog at one folder.
   *
   * The URL because `?folder=` is a shareable deep link and the catalog reads it
   * on arrival; the state because the folder actions in the page head read that.
   * Setting one and not the other is how the menu comes to offer Delete on a
   * folder the list is no longer showing.
   */
  function applyFolderFacet(folder: string) {
    setFacetFolder(folder);
    void setDriveNavQuery(
      { folder: folder || null, view: "workspace" },
      { history: "replace" },
    );
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
      /**
       * And narrow the catalog to it, or the folder is unreachable.
       *
       * The facet list names folders that hold a file, because that is what the
       * catalog knows about. A folder created a second ago holds nothing, so it
       * could not be selected, could not be uploaded into, and could not be
       * renamed or deleted either: created and then invisible forever. Found by
       * driving a preview, not by a test.
       *
       * Applying it here closes the loop. The reader lands in the empty folder
       * they just made, Upload puts a file in it, and from then on the facet
       * list carries it like any other.
       */
      applyFolderFacet(
        targetFolder
          ? `${targetFolder}/${newFolderName.trim()}`
          : newFolderName.trim(),
      );
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
            itemToMove.type === "file" ? itemToMove.pathname : itemToMove.name,
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

  /**
   * The applied folder's ancestors, which are the places a move can go *up* to.
   *
   * Named for a breadcrumb it used to draw. The trail is gone; these are still
   * the destinations above the current one, and the move dialog still needs
   * them.
   */
  const facetAncestors = currentFolder ? currentFolder.split("/") : [];

  const availableDestinations = (() => {
    if (!itemToMove) return [];

    const destinations: Array<{ path: string; label: string }> = [];

    // Only include Root if not already at root
    if (currentFolder !== "") {
      destinations.push({ path: "", label: t("rootFolder") });
    }

    facetAncestors.forEach((_, index) => {
      const ancestorPath = facetAncestors.slice(0, index + 1).join("/");
      // Skip currentFolder itself—can't move to where it already is
      if (ancestorPath === currentFolder) {
        return;
      }
      destinations.push({
        path: ancestorPath,
        label: facetAncestors.slice(0, index + 1).join(" / "),
      });
    });

    // Use allFolders (loaded on dialog open) instead of items (current folder only)
    // to enable cross-branch moves
    const foldersToShow = allFolders.filter((folder) => {
      // Exclude the item being moved
      const folderPath = folder.name;
      const itemPath =
        itemToMove.type === "file" ? itemToMove.pathname : itemToMove.name;

      // Basic exclusion: don't show the item being moved
      if (folderPath === itemPath) {
        return false;
      }

      // For folders, exclude descendants to prevent moving into own subtree
      if (itemToMove.type === "folder") {
        const folderPathNormalized = folder.name;
        if (folderPathNormalized.startsWith(`${itemToMove.name}/`)) {
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

    /**
     * Nothing. The Workspace tab is the catalog, and the catalog has its own
     * list — this one only ever serves the Tasks view above.
     */
    return [];
  })();

  const emptyState = !loading && isTasksView && exploreItems.length === 0;
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

  const driveTablesFilterLabels = {
    title: t("filterTitle"),
    searchPlaceholder: t("filterSearchPlaceholder"),
    emptyResults: t("filterEmptyResults"),
    statusLabel: t("filterStatusLabel"),
    active: t("filterStatusActive"),
    archived: t("filterStatusArchived"),
  };

  function handleTablesArchivedChange(next: boolean) {
    void setDriveNavQuery(
      { archived: next ? true : null },
      { history: "replace" },
    );
  }

  function handleFilesViewModeChange(next: FilesViewMode) {
    setFilesViewMode(next);
    document.cookie = serializeFilesViewModeCookie(next);
  }

  function handleFilesSortChange(next: FilesSortSelection | null) {
    void setDriveNavQuery(filesSortUrlValues(next), { history: "replace" });
  }

  const filesViewModeSwitch = (
    <ListGridViewSwitch
      className="hidden @2xl:flex"
      data-testid="files-view-mode-switch"
      value={filesViewMode}
      onChange={handleFilesViewModeChange}
      labels={{
        list: t("viewList"),
        grid: t("viewGrid"),
      }}
    />
  );

  /**
   * Always tasks. The only list this control orders is the Tasks view's; the
   * `"browse"` surface it used to switch to was the folder strip the catalog
   * replaced.
   */
  const filesSortSurface = "tasks" as const;
  const filesSortLabels = {
    sort: t("sortLabel"),
    name: t("sortByName"),
    date: t("sortByDate"),
    type: t("sortByType"),
    ascending: t("sortAscending"),
    descending: t("sortDescending"),
  };
  /**
   * Everything the folder grid used to carry, out in the open.
   *
   * Rename, move and delete lived on the folder cards and nowhere else, and
   * then in a "..." menu that hid them along with the way to the task outputs.
   * They act on the folder the reader is standing in, so they sit beside the
   * folder trail as labelled buttons and are absent at the root, where there is
   * no folder to act on.
   */
  const facetFolderItem: DriveItem | null = facetFolder
    ? { type: "folder", name: facetFolder, path: facetFolder }
    : null;
  const folderName = facetFolder.split("/").at(-1) ?? facetFolder;
  const folderActions = facetFolderItem ? (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5"
        data-testid="files-rename-folder"
        aria-label={t("renameFolderAction", { name: folderName })}
        onClick={() => {
          const next = window.prompt(t("folderName"), folderName)?.trim();
          if (next) void handleRename(facetFolderItem, next);
        }}
      >
        <Pencil className="size-4" aria-hidden />
        <span className="hidden @lg:inline">{t("renameFolderButton")}</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5"
        data-testid="files-move-folder"
        aria-label={t("moveFolderAction")}
        onClick={() => openMoveDialog(facetFolderItem)}
      >
        <FolderInput className="size-4" aria-hidden />
        <span className="hidden @lg:inline">{t("moveFolderAction")}</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-semantic-destructive-solid gap-1.5"
        data-testid="files-delete-folder"
        aria-label={t("deleteFolderAction")}
        onClick={() => openDeleteDialog(facetFolderItem)}
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="hidden @lg:inline">{t("deleteFolderAction")}</span>
      </Button>
    </>
  ) : null;

  const filesSortControl = (
    <DriveSortControl
      value={filesSortSelection}
      onChange={handleFilesSortChange}
      surface={filesSortSurface}
      labels={filesSortLabels}
      className="hidden @2xl:block"
    />
  );

  return (
    <div className={cn("@container w-full", LIST_MOBILE_CREATE_FAB_CLEARANCE)}>
      <div className="mb-4 flex flex-col gap-4 md:mb-6">
        <div
          data-testid="files-desktop-header"
          className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3 @xl:flex-1">
            <DriveViewTabs
              activeView={primaryView}
              onViewChange={navigateToPrimaryView}
            />
            {/* Phone only: Tasks and New folder share one overflow menu beside
                the tabs. Upload stays the FAB, the thumb-reach create control
                every list uses. */}
            {!isTasksView && isWorkspaceView ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-11 shrink-0 @2xl:hidden"
                    aria-label={t("moreActions")}
                    data-testid="files-mobile-actions"
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={openCreateFolderDialog}
                    data-testid="files-mobile-create-folder"
                  >
                    <FolderPlus className="size-4" aria-hidden />
                    {t("createFolder")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {isTasksView && (
              <>
                <div className="hidden items-center gap-2 @2xl:flex">
                  <div className="relative">
                    <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                    <Input
                      type="text"
                      placeholder={t("tasksSearchPlaceholder")}
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className={cn(
                        "w-64 max-w-full pl-8",
                        DRIVE_HEADER_CONTROL_CLASS,
                      )}
                    />
                  </div>
                </div>
                <div className="hidden @2xl:block">
                  <DriveTasksFilters
                    activeOrganizationId={activeOrganizationId}
                    assigneeId={assigneeIdParam}
                    projectId={projectIdParam}
                    taskId={taskIdParam}
                    labels={driveTasksFilterLabels}
                    hideMobileTrigger
                    sheetOpen={tasksFilterSheetOpen}
                    onSheetOpenChange={setTasksFilterSheetOpen}
                  />
                </div>
              </>
            )}
            {!isTasksView && isWorkspaceView && (
              <div className="hidden items-center gap-2 @2xl:flex">
                {/* No search field here. The catalog's own is the first thing
                    on the page, directly under the tabs, and two search boxes
                    over one list is the duplication this tab was merged to
                    remove. */}
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
              <div className="hidden items-center gap-2 @2xl:flex">
                <div className="relative">
                  <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                  <Input
                    type="text"
                    placeholder={t("searchPlaceholder")}
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className={cn(
                      "w-64 max-w-full pl-8",
                      DRIVE_HEADER_CONTROL_CLASS,
                    )}
                  />
                </div>
              </div>
            )}
            {isTablesView && (
              <>
                <DriveTablesFilters
                  archived={tablesArchived}
                  onArchivedChange={handleTablesArchivedChange}
                  labels={driveTablesFilterLabels}
                />
                <TableCreateDialog
                  key={activeOrganizationId ?? "personal"}
                  workspaceId={activeOrganizationId}
                />
              </>
            )}
            {/* Tasks only. The Workspace tab is the catalog, which orders by
                relevance or recency and is not what this control drives — it
                sorted the folder strip that used to sit above it. A sort control
                that does not reorder the list under it is exactly the kind of
                thing this tab was merged to remove. */}
            {isTasksView ? filesSortControl : null}
            {!isTablesView && filesViewModeSwitch}
          </div>
        </div>

        {isTasksView ? (
          <nav
            className="app-scrollbar text-muted-foreground flex items-center gap-1 overflow-x-auto text-sm"
            aria-label={t("breadcrumbNavLabel")}
          >
            {/* Same root crumb as the browse trail. The tasks view keeps it at
            every depth: its tab is the workspace tab, which is already
            selected here, so this is the only control that leaves the tasks
            list for the file root. */}
            <button
              type="button"
              onClick={navigateToWorkspaceRoot}
              className="press hover:text-foreground whitespace-nowrap transition-colors"
              title={t("workspaceTab")}
            >
              {t("workspaceTab")}
            </button>
            {tasksBreadcrumbs.map((crumb, index) => (
              <span key={index} className="flex shrink-0 items-center gap-1">
                <ChevronRight className="size-4" aria-hidden />
                <button
                  type="button"
                  onClick={crumb.onClick}
                  className={cn(
                    "press hover:text-foreground whitespace-nowrap transition-colors",
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
        <div
          className="mb-6 flex items-center gap-2 @2xl:hidden"
          data-testid="tasks-mobile-toolbar"
        >
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label={t("moreActions")}
                data-testid="tasks-mobile-actions"
                className="relative"
              >
                <MoreHorizontal className="size-4" aria-hidden />
                {assigneeIdParam !== null ||
                projectIdParam !== null ||
                taskIdParam !== null ? (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background"
                  />
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DriveSortMenuItems
                value={filesSortSelection}
                onChange={handleFilesSortChange}
                surface={filesSortSurface}
                labels={filesSortLabels}
                testIdPrefix="tasks-mobile-sort"
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setTasksFilterSheetOpen(true)}
                data-testid="tasks-mobile-filter"
              >
                <ListFilter className="size-4" aria-hidden />
                {t("filterTitle")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {!isTasksView && isRecentsView && (
        <div className="mb-6 flex items-center gap-2 @2xl:hidden">
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

      {isTablesView ? (
        <TableList
          archived={tablesArchived}
          key={activeOrganizationId ?? "personal"}
          workspaceId={activeOrganizationId}
        />
      ) : isRecentsView ? (
        <DriveRecentsPanel
          driveStore={driveStore}
          activeOrganizationId={activeOrganizationId}
          searchQuery={debouncedSearchQuery}
          reloadToken={recentsReloadToken}
          viewMode={layoutMode}
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
            "bg-card-background flex flex-col items-center justify-center overflow-hidden rounded-xl px-4 py-12 text-center",
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
          className={driveItemsPanelClass(layoutMode, { fillsThePage: true })}
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
                            "dateTimeWithYear",
                          )}
                        </span>
                      </div>
                    </div>
                    <div className={driveItemMetaDesktopClass(layoutMode)}>
                      <span>
                        {formatter.dateTime(
                          new Date(item.latestFileUpdatedAt),
                          "dateTimeWithYear",
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
                            "dateTimeWithYear",
                          )}
                        </span>
                      </div>
                    </div>
                    <div className={driveItemMetaDesktopClass(layoutMode)}>
                      <span>
                        {formatter.dateTime(
                          new Date(item.latestFileUpdatedAt),
                          "dateTimeWithYear",
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
                            "dateTimeWithYear",
                          )}
                        </span>
                      </div>
                    </div>
                    <div className={driveItemMetaDesktopClass(layoutMode)}>
                      <span>
                        {formatter.dateTime(
                          new Date(item.latestFileUpdatedAt),
                          "dateTimeWithYear",
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
                                data-testid="drive-item-more-actions"
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
                            <p className="text-muted-foreground line-clamp-1 text-xs">
                              {searchContext}
                            </p>
                          ) : null}
                          <div className={driveItemMetaMobileClass(layoutMode)}>
                            <span>
                              {item.size ? formatBytes(item.size) : "—"}
                            </span>
                            <span>
                              {formatter.dateTime(
                                new Date(item.updatedAt),
                                "dateTimeWithYear",
                              )}
                            </span>
                          </div>
                        </div>
                        <div className={driveItemMetaDesktopClass(layoutMode)}>
                          <span>
                            {item.size ? formatBytes(item.size) : "—"}
                          </span>
                          <span>
                            {formatter.dateTime(
                              new Date(item.updatedAt),
                              "dateTimeWithYear",
                            )}
                          </span>
                        </div>
                        {viewers}
                      </DriveItemCard>
                    )}
                  </DriveFilePreview>
                );
              }

              /**
               * Nothing else reaches here.
               *
               * `blob-file` and `blob-folder` were the folder grid that owned
               * the top of the Workspace tab. The catalog replaced it, and this
               * list now serves the Tasks view only.
               */
              return null;
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

      {/**
       * The catalog. It is the Workspace tab, not a section of it.
       *
       * Every file in the workspace, searchable and filterable, with the search
       * box directly under the tabs and the first file row immediately below
       * it. It used to render *beneath* a folder grid that owned the top of the
       * page, so the reader met two navigation models stacked on one screen and
       * picked neither.
       *
       * Folders did not go: `?folder=` pre-applies one as a facet, and folder
       * create, rename, move and delete moved into the page head's actions
       * menu, which is the only place they ever lived outside the grid.
       */}
      {isWorkspaceView && !isTasksView ? (
        <DriveAllFilesPanel
          store={allFilesStore}
          viewMode={layoutMode}
          isMobile={isMobile}
          // Global search's "See all files" arrives with the query already
          // typed; dropping it made the reader type it a second time.
          initialQuery={searchParams.get("q") ?? ""}
          initialFolder={folderParam}
          onFolderChange={applyFolderFacet}
          folderActions={folderActions}
          virtualFolder={{
            label: t("tasksFolder"),
            onOpen: navigateToTasksRoot,
          }}
          reloadToken={catalogReloadToken}
        />
      ) : null}

      {!isTasksView && isWorkspaceView && (
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
              className="bg-semantic-destructive-solid text-destructive-foreground hover:bg-destructive-hover"
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
          <div className="app-scrollbar max-h-96 space-y-2 overflow-y-auto">
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
                    "text-foreground press hover:bg-card-background flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
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
