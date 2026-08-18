"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import { Check, Download, Edit3, Trash2, Upload, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactElement, useCallback, useEffect, useState } from "react";
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
import { DocumentViewer } from "@/components/ui/document-viewer";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { ImageViewer } from "@/components/ui/image-viewer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";
import { useSession } from "@/lib/auth/auth.client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveFile } from "@/lib/clients/generated/core";
import {
  deleteDriveFilesDelete,
  getDriveFiles,
  getUsersByIdOrganizations,
  patchDriveFilesRename,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  getDriveFileUploadErrorMessage,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import { formatBytes } from "@/lib/utils/format-bytes";

function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof date === "string" ? new Date(date) : date);
}

interface FileNameWithPreviewProps {
  file: DriveFile;
  isPreviewable: boolean;
  isImage: boolean;
  documentKind: "office" | "pdf" | "text" | null;
}

function FileNameWithPreview({
  file,
  isPreviewable,
  isImage,
  documentKind,
}: FileNameWithPreviewProps) {
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isDocumentViewerOpen, setIsDocumentViewerOpen] = useState(false);

  if (!isPreviewable) {
    return (
      <span className="text-foreground line-clamp-1 text-sm font-medium">
        {file.name}
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
        {file.name}
      </button>
      {isImage && (
        <ImageViewer
          open={isImageViewerOpen}
          onOpenChange={setIsImageViewerOpen}
          src={file.fileUrl}
          alt={file.name}
          downloadFilename={file.name}
        />
      )}
      {documentKind && (
        <DocumentViewer
          open={isDocumentViewerOpen}
          onOpenChange={setIsDocumentViewerOpen}
          url={file.fileUrl}
          fileName={file.name}
          kind={documentKind}
        />
      )}
    </>
  );
}

export default function DrivePage(): ReactElement {
  const { data: session } = useSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editingFilePathname, setEditingFilePathname] = useState<string | null>(
    null,
  );
  const [editingFileName, setEditingFileName] = useState("");
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<DriveFile | null>(null);

  const scope = (searchParams.get("scope") as "me" | "org") || "me";

  useRegisterBreadcrumbOverride({
    pathname,
    segments: [{ label: "Drive", href: "/drive" }],
  });

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getDriveFiles({
        client: getBrowserCoreClient(),
        query: {
          scope,
          ...(scope === "org" && activeOrganizationId
            ? { organizationId: activeOrganizationId }
            : {}),
        },
      });
      setFiles((response.data?.data as DriveFile[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [scope, activeOrganizationId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

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
        onUploadProgress: (progress) => {
          setUploadProgress(progress.percentage);
        },
      });

      await loadFiles();
    } catch (err) {
      setError(getDriveFileUploadErrorMessage(err));
    } finally {
      setUploading(false);
      setUploadProgress(0);
      event.target.value = "";
    }
  }

  async function handleRename(pathname: string, newName: string) {
    if (!newName.trim()) {
      return;
    }

    setError(null);
    try {
      await patchDriveFilesRename({
        client: getBrowserCoreClient(),
        body: {
          oldPathname: pathname,
          newFilename: newName.trim(),
        },
      });
      setEditingFilePathname(null);
      setEditingFileName("");
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename file");
    }
  }

  function openDeleteDialog(file: DriveFile) {
    setFileToDelete(file);
    setDeleteDialogOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!fileToDelete) {
      return;
    }

    setError(null);
    try {
      await deleteDriveFilesDelete({
        client: getBrowserCoreClient(),
        body: {
          pathname: fileToDelete.pathname,
        },
      });
      setDeleteDialogOpen(false);
      setFileToDelete(null);
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete file");
    }
  }

  function handleDownload(fileUrl: string, fileName: string) {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function startEdit(file: DriveFile) {
    setEditingFilePathname(file.pathname);
    setEditingFileName(file.name);
  }

  function cancelEdit() {
    setEditingFilePathname(null);
    setEditingFileName("");
  }

  function switchScope(newScope: "me" | "org") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", newScope);
    router.push(`/drive?${params.toString()}`);
  }

  const emptyState = !loading && files.length === 0;
  const hasFiles = files.length > 0;

  return (
    <div className="w-full px-2">
      <Tabs value={scope} onValueChange={(v) => switchScope(v as "me" | "org")}>
        <div className="mb-6 flex items-center justify-between gap-4">
          <TabsList className="bg-muted/50 flex items-center gap-1 self-start rounded-lg p-1">
            <TabsTrigger
              value="me"
              className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
            >
              My Drive
            </TabsTrigger>
            {activeOrganizationId && (
              <TabsTrigger
                value="org"
                className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
              >
                {organizationName || "Organization"}
              </TabsTrigger>
            )}
          </TabsList>

          <div>
            <Label htmlFor="file-upload" className="cursor-pointer">
              <Button
                disabled={uploading}
                size="sm"
                className="gap-1.5"
                asChild
              >
                <span>
                  <Upload className="size-4" aria-hidden />
                  {uploading ? `${uploadProgress}%` : "Upload"}
                </span>
              </Button>
            </Label>
            <Input
              id="file-upload"
              type="file"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </div>
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
                      "-mx-2 flex items-center gap-2 rounded-lg px-2",
                      PROJECTS_LIST_ROW_LAYOUT_CLASS,
                    )}
                  >
                    <div className="flex size-6 shrink-0 items-center justify-center px-1">
                      <Skeleton className="size-4" />
                    </div>
                    <div className="flex min-w-0 flex-1 items-center gap-4 py-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                        <Skeleton className="h-4 w-32 sm:w-48" />
                        <div className="flex items-center gap-3">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Skeleton className="size-8" />
                        <Skeleton className="size-8" />
                        <Skeleton className="size-8" />
                      </div>
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
                  No files yet
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  Upload your first file to get started
                </p>
              </div>
            </div>
          ) : hasFiles ? (
            <div
              className={cn(
                "bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border",
                PROJECTS_LIST_CARD_MIN_H_CLASS,
              )}
            >
              <div className="divide-border/50 divide-y px-2">
                {files.map((file) => {
                  const extension = getExtensionFromUrl(file.name);
                  const isEditing = editingFilePathname === file.pathname;
                  const { isImage, documentKind } = classifyFilePreview(
                    file.fileUrl,
                    file.name,
                  );
                  const isPreviewable = isImage || documentKind !== null;

                  return (
                    <article
                      key={file.pathname}
                      className={cn(
                        "-mx-2 flex items-center gap-2 rounded-lg px-2 hover:bg-muted/50",
                        PROJECTS_LIST_ROW_LAYOUT_CLASS,
                      )}
                    >
                      <div className="flex size-6 shrink-0 items-center justify-center px-1">
                        <FileTypeIcon extension={extension || "file"} />
                      </div>

                      <div className="flex min-w-0 flex-1 items-center gap-4 py-3">
                        {isEditing ? (
                          <Input
                            value={editingFileName}
                            onChange={(e) => setEditingFileName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleRename(
                                  file.pathname,
                                  editingFileName,
                                );
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
                              <FileNameWithPreview
                                file={file}
                                isPreviewable={isPreviewable}
                                isImage={isImage}
                                documentKind={documentKind}
                              />
                              <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                                <span>
                                  {file.size ? formatBytes(file.size) : "—"}
                                </span>
                                <span>{formatDate(file.uploadedAt)}</span>
                              </div>
                            </div>
                            <div className="text-muted-foreground/70 hidden shrink-0 items-center gap-3 text-xs md:flex">
                              <span>
                                {file.size ? formatBytes(file.size) : "—"}
                              </span>
                              <span>{formatDate(file.uploadedAt)}</span>
                            </div>
                          </>
                        )}

                        <div className="flex shrink-0 items-center gap-1">
                          {isEditing ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void handleRename(
                                    file.pathname,
                                    editingFileName,
                                  )
                                }
                                title="Save"
                              >
                                <Check className="size-4" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={cancelEdit}
                                title="Cancel"
                              >
                                <X className="size-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  handleDownload(file.fileUrl, file.name)
                                }
                                title="Download"
                              >
                                <Download className="size-4" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => startEdit(file)}
                                title="Rename"
                                disabled={editingFilePathname !== null}
                              >
                                <Edit3 className="size-4" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => openDeleteDialog(file)}
                                title="Delete"
                                disabled={editingFilePathname !== null}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{fileToDelete?.name}</strong>? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteConfirm();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
