"use client";

import {
  Check,
  Download,
  Edit3,
  HardDrive,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactElement, useCallback, useEffect, useState } from "react";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth/auth.client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveFile } from "@/lib/clients/generated/core";
import {
  deleteDriveFilesDelete,
  getDriveFiles,
  getUsersByIdOrganizations,
  patchDriveFilesRename,
} from "@/lib/clients/generated/core";
import {
  getDriveFileUploadErrorMessage,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";
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

export default function DrivePage(): ReactElement {
  const { data: session } = useSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
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

      // Refetch immediately after upload (no 2s wait)
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

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="size-8" />
          <div>
            <h1 className="text-3xl font-bold">Drive</h1>
            <p className="text-muted-foreground text-sm">
              Manage your files and documents
            </p>
          </div>
        </div>
        <div>
          <Label htmlFor="file-upload" className="cursor-pointer">
            <Button disabled={uploading} asChild>
              <span>
                <Upload className="size-4 mr-2" />
                {uploading ? `Uploading... ${uploadProgress}%` : "Upload File"}
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
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      <Tabs value={scope} onValueChange={(v) => switchScope(v as "me" | "org")}>
        <TabsList>
          <TabsTrigger value="me">My Drive</TabsTrigger>
          {activeOrganizationId && (
            <TabsTrigger value="org">
              {organizationName || "Organization"}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value={scope} className="mt-6">
          {emptyState ? (
            <Card>
              <CardHeader>
                <CardTitle>No files yet</CardTitle>
                <CardDescription>
                  Upload your first file to get started
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8">
                          Loading...
                        </TableCell>
                      </TableRow>
                    ) : (
                      files.map((file) => (
                        <TableRow key={file.pathname}>
                          <TableCell>
                            {editingFilePathname === file.pathname ? (
                              <Input
                                value={editingFileName}
                                onChange={(e) =>
                                  setEditingFileName(e.target.value)
                                }
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
                                className="h-8"
                                autoFocus
                              />
                            ) : (
                              <span className="font-medium">{file.name}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {file.size ? formatBytes(file.size) : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(file.uploadedAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            {editingFilePathname === file.pathname ? (
                              <div className="flex justify-end gap-2">
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
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
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
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
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
