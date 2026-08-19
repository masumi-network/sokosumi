"use client";

import { ChevronRight, FileIcon, Folder, Loader2, Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
          (item) => item.name !== "__drive_folder__",
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("selectTitle")}</DialogTitle>
          <DialogDescription>{t("selectDescription")}</DialogDescription>
        </DialogHeader>

        <Tabs value={scope} onValueChange={handleTabChange}>
          <div className="space-y-3">
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

            {breadcrumbSegments.length > 0 && (
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

            <div className="relative">
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

          <TabsContent value={scope} className="mt-4">
            {error ? (
              <div className="text-destructive text-center py-8 text-sm">
                {error}
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="text-muted-foreground size-6 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="text-muted-foreground text-center py-8 text-sm">
                {searchQuery ? t("noMatchTitle") : t("pickerEmptyMessage")}
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-1">
                  {items.map((item) => {
                    const itemKey =
                      item.type === "file"
                        ? item.pathname
                        : `folder:${item.name}`;

                    if (item.type === "folder") {
                      return (
                        <Button
                          key={itemKey}
                          variant="ghost"
                          className="h-auto w-full justify-start p-3 hover:bg-accent"
                          onClick={() => navigateToFolder(item.name)}
                        >
                          <div className="flex w-full items-start gap-3">
                            <Folder className="text-muted-foreground size-5 shrink-0" />
                            <div className="min-w-0 flex-1 text-left">
                              <div className="truncate font-medium">
                                {item.name}
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {t("folder")}
                              </div>
                            </div>
                          </div>
                        </Button>
                      );
                    }

                    return (
                      <Button
                        key={itemKey}
                        variant="ghost"
                        className="h-auto w-full justify-start p-3 hover:bg-accent"
                        onClick={() => handleFileClick(item)}
                      >
                        <div className="flex w-full items-start gap-3">
                          <FileIcon className="text-muted-foreground size-5 shrink-0" />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="truncate font-medium">
                              {item.name}
                            </div>
                            <div className="text-muted-foreground flex gap-2 text-xs">
                              {item.size ? (
                                <span>{formatBytes(item.size)}</span>
                              ) : null}
                              <span>
                                {formatter.dateTime(new Date(item.uploadedAt), {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </Button>
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
