"use client";

import { FileIcon, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
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
import { useSession } from "@/lib/auth/auth.client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveFile } from "@/lib/clients/generated/core";
import { getUsersByIdOrganizations } from "@/lib/clients/generated/core";
import { listDriveFiles } from "@/lib/utils/drive-file-list.client";
import { formatBytes } from "@/lib/utils/format-bytes";

interface DriveFilePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (file: DriveFile) => void;
}

function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(typeof date === "string" ? new Date(date) : date);
}

export function DriveFilePicker({
  open,
  onOpenChange,
  onSelect,
}: DriveFilePickerProps) {
  const { data: session } = useSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const [scope, setScope] = useState<"me" | "org">("me");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const t = useTranslations("App.Drive");

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (scope === "org" && !activeOrganizationId) {
        setFiles([]);
        return;
      }

      const loaded = await listDriveFiles({
        scope,
        ...(scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}),
      });
      setFiles(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [scope, activeOrganizationId, searchQuery]);

  useEffect(() => {
    if (open) {
      void loadFiles();
    }
  }, [open, loadFiles]);

  useEffect(() => {
    async function fetchOrganizationName() {
      if (!activeOrganizationId || !session?.user?.id) {
        setOrganizationName(null);
        return;
      }

      try {
        const response = await getUsersByIdOrganizations({
          client: getBrowserCoreClient(),
          path: { id: session.user.id },
        });
        const orgs = response.data?.data || [];
        const activeOrg = orgs.find((org) => org.id === activeOrganizationId);
        setOrganizationName(activeOrg?.name ?? null);
      } catch {
        setOrganizationName(null);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select from Drive</DialogTitle>
          <DialogDescription>
            Choose a file from your personal or organization Drive
          </DialogDescription>
        </DialogHeader>

        <Tabs value={scope} onValueChange={(v) => setScope(v as "me" | "org")}>
          <div className="flex items-center gap-2">
            <TabsList className="flex-1">
              <TabsTrigger value="me" className="flex-1">
                {t("myDriveTab")}
              </TabsTrigger>
              {activeOrganizationId && (
                <TabsTrigger value="org" className="flex-1">
                  {organizationName || t("organizationTabFallback")}
                </TabsTrigger>
              )}
            </TabsList>
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
              <Input
                type="text"
                placeholder={t("searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pl-8"
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
            ) : files.length === 0 ? (
              <div className="text-muted-foreground text-center py-8 text-sm">
                {searchQuery.trim()
                  ? t("noMatchTitle")
                  : t("pickerEmptyMessage")}
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-1">
                  {files.map((file) => (
                    <Button
                      key={file.pathname}
                      variant="ghost"
                      className="h-auto w-full justify-start p-3 hover:bg-accent"
                      onClick={() => handleFileClick(file)}
                    >
                      <div className="flex w-full items-start gap-3">
                        <FileIcon className="text-muted-foreground size-5 shrink-0" />
                        <div className="min-w-0 flex-1 text-left">
                          <div className="truncate font-medium">
                            {file.name}
                          </div>
                          <div className="text-muted-foreground flex gap-2 text-xs">
                            {file.size ? (
                              <span>{formatBytes(file.size)}</span>
                            ) : null}
                            <span>{formatDate(file.uploadedAt)}</span>
                          </div>
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
