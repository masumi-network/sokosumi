"use client";

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
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getEnvPublicConfig } from "@/config/env.public";
import { useSession } from "@/lib/auth/auth.client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveFile, DriveItem } from "@/lib/clients/generated/core";
import { getUsersByIdOrganizations } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { listDriveItems } from "@/lib/utils/drive-file-list.client";
import { formatBytes } from "@/lib/utils/format-bytes";

interface DriveFilePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (file: DriveFile) => void;
}

export function DriveFilePicker({
  open,
  onOpenChange,
  onSelect,
}: DriveFilePickerProps) {
  const t = useTranslations("App.Drive");
  const formatter = useFormatter();
  const { data: session } = useSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const [scope, setScope] = useState<"me" | "org">("me");
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [currentFolder, setCurrentFolder] = useState("");

  const loadFilesAbortRef = useRef<AbortController | null>(null);
  const fetchOrgNameAbortRef = useRef<AbortController | null>(null);

  const debouncedSetSearchQuery = useDebouncedCallback((value: string) => {
    setDebouncedSearchQuery(value);
  }, getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    debouncedSetSearchQuery(value);
  }

  const loadItems = useCallback(async () => {
    loadFilesAbortRef.current?.abort();
    const controller = new AbortController();
    loadFilesAbortRef.current = controller;

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
        const filteredItems = loaded.filter(
          (item) => !isDriveFolderMarkerName(item.name),
        );
        setItems(filteredItems);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : t("loadFilesError"));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [scope, activeOrganizationId, currentFolder, debouncedSearchQuery, t]);

  useEffect(() => {
    if (open) {
      void loadItems();
    }
  }, [open, loadItems]);

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

    if (open) {
      void fetchOrganizationName();
    }
  }, [open, activeOrganizationId, session?.user?.id]);

  function handleFileClick(file: DriveFile) {
    onSelect(file);
    onOpenChange(false);
  }

  function handleTabChange(value: string) {
    if (value === "me" || value === "org") {
      setScope(value);
      setCurrentFolder("");
    }
  }

  function navigateToFolder(folderName: string) {
    const newPath = currentFolder
      ? `${currentFolder}/${folderName}`
      : folderName;

    if (newPath === currentFolder) {
      return;
    }

    setCurrentFolder(newPath);
  }

  function navigateToBreadcrumb(index: number) {
    if (index === -1) {
      setCurrentFolder("");
    } else {
      const segments = currentFolder.split("/");
      const newPath = segments.slice(0, index + 1).join("/");
      setCurrentFolder(newPath);
    }
  }

  const breadcrumbSegments = currentFolder ? currentFolder.split("/") : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl min-w-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("selectTitle")}</DialogTitle>
          <DialogDescription>{t("selectDescription")}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={scope}
          onValueChange={handleTabChange}
          className="min-w-0 w-full"
        >
          <div className="space-y-3 min-w-0 w-full">
            <TabsList className="w-full">
              <TabsTrigger value="me" className="flex-1">
                {t("myDriveTab")}
              </TabsTrigger>
              {activeOrganizationId && (
                <TabsTrigger value="org" className="flex-1">
                  {organizationName || t("organizationTabFallback")}
                </TabsTrigger>
              )}
            </TabsList>

            <div className="min-w-0 overflow-x-auto">
              <nav
                className="text-muted-foreground flex flex-nowrap items-center gap-1 text-sm"
                aria-label={t("breadcrumbNavLabel")}
              >
                <button
                  type="button"
                  onClick={() => navigateToBreadcrumb(-1)}
                  className={cn(
                    "hover:text-foreground shrink-0 whitespace-nowrap transition-colors",
                    breadcrumbSegments.length === 0 &&
                      "text-foreground font-medium",
                  )}
                  aria-label={
                    scope === "org"
                      ? organizationName || t("organizationTabFallback")
                      : t("myDriveTab")
                  }
                  title={
                    scope === "org"
                      ? organizationName || t("organizationTabFallback")
                      : t("myDriveTab")
                  }
                >
                  {scope === "org" ? (
                    <Building2 className="size-4" aria-hidden />
                  ) : (
                    <Home className="size-4" aria-hidden />
                  )}
                </button>
                {breadcrumbSegments.map((segment, index) => (
                  <span
                    key={index}
                    className="flex shrink-0 items-center gap-1"
                  >
                    <ChevronRight className="size-4" aria-hidden />
                    <button
                      type="button"
                      onClick={() => navigateToBreadcrumb(index)}
                      className={cn(
                        "hover:text-foreground shrink-0 whitespace-nowrap transition-colors",
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
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <TabsContent value={scope} className="mt-4 min-w-0 w-full">
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
            ) : items.length === 0 ? (
              <div className="text-muted-foreground flex min-h-[400px] items-center justify-center text-center text-sm">
                {searchQuery ? t("noMatchTitle") : t("pickerEmptyMessage")}
              </div>
            ) : (
              <ScrollArea
                className="h-[400px] pr-4 min-w-0 w-full"
                shrinkContent
              >
                <div className="space-y-1">
                  {items.map((item) => {
                    const itemKey =
                      item.type === "file"
                        ? item.pathname
                        : `folder:${item.name}`;

                    if (item.type === "folder") {
                      return (
                        <button
                          key={itemKey}
                          type="button"
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
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
