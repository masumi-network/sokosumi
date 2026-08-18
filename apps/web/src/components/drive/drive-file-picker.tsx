"use client";

import { FileIcon, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth/auth.client";
import type { DriveFile } from "@/lib/clients/generated/core";
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
      });
      setFiles(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [scope, activeOrganizationId]);

  useEffect(() => {
    if (open) {
      void loadFiles();
    }
  }, [open, loadFiles]);

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
          <TabsList className="w-full">
            <TabsTrigger value="me" className="flex-1">
              My Drive
            </TabsTrigger>
            {activeOrganizationId && (
              <TabsTrigger value="org" className="flex-1">
                Organization Drive
              </TabsTrigger>
            )}
          </TabsList>

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
                No files in this Drive
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
