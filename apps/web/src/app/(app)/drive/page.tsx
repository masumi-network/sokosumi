"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import {
  Check,
  Download,
  Edit3,
  MoreHorizontal,
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
import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";
import { useSession } from "@/lib/auth/auth.client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveFile } from "@/lib/clients/generated/core";
import {
  deleteDriveFilesDelete,
  getUsersByIdOrganizations,
  patchDriveFilesRename,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { listDriveFiles } from "@/lib/utils/drive-file-list.client";
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
  const t = useTranslations("App.Drive");
  const formatter = useFormatter();
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

  const loadFilesAbortRef = useRef<AbortController | null>(null);
  const fetchOrgNameAbortRef = useRef<AbortController | null>(null);

  const scopeParam = searchParams.get("scope");
  const scope: "me" | "org" = scopeParam === "org" ? "org" : "me";

  useRegisterBreadcrumbOverride({
    pathname,
    segments: [{ label: t("breadcrumb"), href: "/drive" }],
  });

  const loadFiles = useCallback(async () => {
    loadFilesAbortRef.current?.abort();
    const controller = new AbortController();
    loadFilesAbortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      if (scope === "org" && !activeOrganizationId) {
        if (!controller.signal.aborted) {
          setFiles([]);
        }
        return;
      }

      const loaded = await listDriveFiles({
        scope,
        ...(scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
      });

      if (!controller.signal.aborted) {
        setFiles(loaded);
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
  }, [scope, activeOrganizationId, t]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

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
        onUploadProgress: (progress) => {
          setUploadProgress(progress.percentage);
        },
      });

      await loadFiles();
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
        throwOnError: true,
      });

      setEditingFilePathname(null);
      setEditingFileName("");
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("renameError"));
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
        throwOnError: true,
      });

      setDeleteDialogOpen(false);
      setFileToDelete(null);
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteError"));
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFabOpen() {
    fileInputRef.current?.click();
  }

  return (
    <div className={cn("w-full px-2", LIST_MOBILE_CREATE_FAB_CLEARANCE)}>
      <Tabs value={scope} onValueChange={(v) => switchScope(v as "me" | "org")}>
        <div className="mb-6 flex items-center justify-between gap-4">
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

          <div className="hidden md:flex">
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
                      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                        <Skeleton className="h-4 w-32 sm:w-48" />
                        <div className="flex items-center gap-3">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-3 w-24" />
                        </div>
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
                  {t("emptyTitle")}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("emptyDescription")}
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
                        "-mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
                        PROJECTS_LIST_ROW_LAYOUT_CLASS,
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
                        <div className="flex size-8 shrink-0 items-center justify-center">
                          <FileTypeIcon extension={extension || "file"} />
                        </div>

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
                                <span>
                                  {formatter.dateTime(
                                    new Date(file.uploadedAt),
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
                            <div className="text-muted-foreground/70 hidden shrink-0 items-center gap-3 text-xs md:flex">
                              <span>
                                {file.size ? formatBytes(file.size) : "—"}
                              </span>
                              <span>
                                {formatter.dateTime(new Date(file.uploadedAt), {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
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
                                void handleRename(
                                  file.pathname,
                                  editingFileName,
                                )
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
                              <DropdownMenuItem
                                onSelect={(event) => {
                                  event.preventDefault();
                                  handleDownload(file.fileUrl, file.name);
                                }}
                              >
                                <Download className="size-4" aria-hidden />
                                {t("downloadAction")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={(event) => {
                                  event.preventDefault();
                                  startEdit(file);
                                }}
                                disabled={editingFilePathname !== null}
                              >
                                <Edit3 className="size-4" aria-hidden />
                                {t("renameAction")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={(event) => {
                                  event.preventDefault();
                                  openDeleteDialog(file);
                                }}
                                disabled={editingFilePathname !== null}
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
            <AlertDialogTitle>{t("deleteDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDialogDescription", {
                fileName: fileToDelete?.name || "",
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
    </div>
  );
}
