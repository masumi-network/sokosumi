"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  AlertDialog,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authClient } from "@/lib/auth/auth.client";
import { Apikey } from "@/prisma/generated/client";

// Types
type CreateApiKeyType = {
  name: string;
};

type DeleteApiKeyType = {
  keyId: string;
  confirmName: string;
};

export function ApiKeysSection() {
  const t = useTranslations("App.Account.ApiKeys");

  // Schemas with translated validation messages
  const createApiKeySchema = z.object({
    name: z
      .string()
      .min(1, t("Validation.nameRequired"))
      .max(100, t("Validation.nameMaxLength"))
      .regex(/^[a-zA-Z0-9\s\-_]+$/, t("Validation.namePattern")),
  });

  const deleteApiKeySchema = z.object({
    keyId: z.string().min(1, t("Validation.keyIdRequired")),
    confirmName: z.string().min(1, t("Validation.confirmNameRequired")),
  });

  const [apiKeys, setApiKeys] = useState<Apikey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<Apikey | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Refs for timeout cleanup
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dialogTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const createForm = useForm<CreateApiKeyType>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: {
      name: "",
    },
  });

  const deleteForm = useForm<DeleteApiKeyType>({
    resolver: zodResolver(deleteApiKeySchema),
    defaultValues: {
      keyId: "",
      confirmName: "",
    },
  });

  // Load API keys
  const loadApiKeys = useCallback(async () => {
    setLoading(true);
    try {
      const result = await authClient.apiKey.list();

      if (result.data) {
        setApiKeys(result.data as Apikey[]);
        setCurrentPage(1); // Reset to first page when reloading
      } else {
        toast.error(t("Messages.loadError"));
      }
    } catch (_error) {
      toast.error(t("Messages.loadError"));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  // Helper function for dialog state cleanup
  const clearDialogStateWithDelay = useCallback(() => {
    if (dialogTimeoutRef.current) {
      clearTimeout(dialogTimeoutRef.current);
    }

    dialogTimeoutRef.current = setTimeout(() => {
      setCreatedKey(null);
      setCopiedKey(false);
      dialogTimeoutRef.current = null;
    }, 300);
  }, []);

  // Cleanup effect for timeouts
  useEffect(() => {
    return () => {
      // Clear all timeouts on unmount
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      if (dialogTimeoutRef.current) {
        clearTimeout(dialogTimeoutRef.current);
      }
    };
  }, []);

  // Handle create API key
  const onCreateSubmit = async (values: CreateApiKeyType) => {
    try {
      const result = await authClient.apiKey.create({
        name: values.name,
      });

      if (result.data) {
        setCreatedKey(result.data.key);
        toast.success(t("Messages.createSuccess"));
        createForm.reset();
        await loadApiKeys();
      } else {
        toast.error(result.error?.message ?? t("Messages.createError"));
      }
    } catch (_error) {
      toast.error(t("Messages.createError"));
    }
  };

  // Handle delete API key
  const onDeleteSubmit = async (values: DeleteApiKeyType) => {
    if (!keyToDelete) return;

    // Verify the confirmation name matches
    if (keyToDelete.name !== values.confirmName) {
      toast.error(t("Messages.confirmNameMismatch"));
      return;
    }

    try {
      const result = await authClient.apiKey.delete({
        keyId: keyToDelete.id,
      });

      if (result.data) {
        toast.success(t("Messages.deleteSuccess"));
        setDeleteDialogOpen(false);
        setKeyToDelete(null);
        deleteForm.reset();
        await loadApiKeys();
      } else {
        toast.error(result.error?.message ?? t("Messages.deleteError"));
      }
    } catch (_error) {
      toast.error(t("Messages.deleteError"));
    }
  };

  // Handle copy to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Messages.copySuccess"));
      setCopiedKey(true);

      // Clear any existing timeout
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }

      // Set new timeout and store reference
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedKey(false);
        copyTimeoutRef.current = null;
      }, 3000);
    } catch (_error) {
      toast.error(t("Messages.copyError"));
    }
  };

  // Handle toggle API key status
  const handleToggleStatus = async (apiKey: Apikey) => {
    try {
      const result = await authClient.apiKey.update({
        keyId: apiKey.id,
        enabled: !apiKey.enabled,
      });

      if (result.data) {
        const action = apiKey.enabled ? "disabled" : "enabled";
        toast.success(t("Messages.updateSuccess", { action }));
        await loadApiKeys();
      } else {
        toast.error(result.error?.message ?? t("Messages.updateError"));
      }
    } catch (_error) {
      toast.error(t("Messages.updateError"));
    }
  };

  // Handle delete button click
  const handleDeleteClick = (apiKey: Apikey) => {
    setKeyToDelete(apiKey);
    deleteForm.reset({
      keyId: apiKey.id,
      confirmName: "",
    });
    setDeleteDialogOpen(true);
  };

  // Pagination logic
  const totalPages = Math.ceil(apiKeys.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedApiKeys = apiKeys.slice(startIndex, startIndex + itemsPerPage);

  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <Dialog
            open={createDialogOpen}
            onOpenChange={(open) => {
              setCreateDialogOpen(open);
              if (!open) {
                // Reset all state when dialog closes
                clearDialogStateWithDelay();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                {t("createButton")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              {!createdKey && (
                <DialogHeader>
                  <DialogTitle>{t("CreateDialog.title")}</DialogTitle>
                  <DialogDescription>
                    {t("CreateDialog.description")}
                  </DialogDescription>
                </DialogHeader>
              )}
              {createdKey ? (
                <>
                  <DialogHeader>
                    <DialogTitle>
                      {t("CreateDialog.CreatedSuccess.title")}
                    </DialogTitle>
                    <DialogDescription>
                      {t("CreateDialog.CreatedSuccess.description")}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="rounded-md py-4">
                      <button
                        onClick={() => copyToClipboard(createdKey)}
                        className="bg-muted hover:bg-muted/80 group relative block w-full cursor-pointer rounded px-[1rem] py-[1rem] text-left transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <code className="pr-2 font-mono text-sm break-all">
                            {createdKey}
                          </code>
                          {copiedKey ? (
                            <Check className="text-semantic-success h-4 w-4 flex-shrink-0" />
                          ) : (
                            <Copy className="text-muted-foreground group-hover:text-foreground h-4 w-4 flex-shrink-0 transition-colors" />
                          )}
                        </div>
                      </button>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => {
                          setCreateDialogOpen(false);
                          clearDialogStateWithDelay();
                        }}
                      >
                        {t("CreateDialog.CreatedSuccess.doneButton")}
                      </Button>
                    </DialogFooter>
                  </div>
                </>
              ) : (
                <Form {...createForm}>
                  <form
                    onSubmit={createForm.handleSubmit(onCreateSubmit)}
                    className="space-y-4"
                  >
                    <FormField
                      control={createForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("CreateDialog.nameLabel")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("CreateDialog.namePlaceholder")}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCreateDialogOpen(false)}
                      >
                        {t("CreateDialog.cancelButton")}
                      </Button>
                      <Button
                        type="submit"
                        disabled={createForm.formState.isSubmitting}
                      >
                        {t("CreateDialog.createButton")}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-muted-foreground py-8 text-center">
            {t("loading")}
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            {t("noKeysFound")}
          </div>
        ) : (
          <div className="space-y-4">
            <ScrollArea>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Table.name")}</TableHead>
                    <TableHead>{t("Table.key")}</TableHead>
                    <TableHead>{t("Table.status")}</TableHead>
                    <TableHead className="w-[100px]">
                      {t("Table.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedApiKeys.map((apiKey) => (
                    <TableRow key={apiKey.id}>
                      <TableCell className="font-medium">
                        {apiKey.name}
                      </TableCell>
                      <TableCell>
                        <code className="bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm">
                          {apiKey.start ?? "••••••••"}
                        </code>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            apiKey.enabled
                              ? "bg-semantic-success/10 text-semantic-success"
                              : "bg-semantic-destructive/10 text-semantic-destructive"
                          }`}
                        >
                          {apiKey.enabled
                            ? t("Status.enabled")
                            : t("Status.disabled")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleStatus(apiKey)}
                            title={
                              apiKey.enabled
                                ? t("Actions.disableTooltip")
                                : t("Actions.enableTooltip")
                            }
                          >
                            {apiKey.enabled ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteClick(apiKey)}
                            title={t("Actions.deleteTooltip")}
                          >
                            <Trash2 className="text-destructive h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">
                  {t("Pagination.showing", {
                    start: startIndex + 1,
                    end: Math.min(startIndex + itemsPerPage, apiKeys.length),
                    total: apiKeys.length,
                  })}
                </p>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePreviousPage}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t("Pagination.previousButton")}
                  </Button>
                  <span className="text-sm">
                    {t("Pagination.page", {
                      current: currentPage,
                      total: totalPages,
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                  >
                    {t("Pagination.nextButton")}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("DeleteDialog.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("DeleteDialog.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {keyToDelete && (
              <Form {...deleteForm}>
                <form
                  onSubmit={deleteForm.handleSubmit(onDeleteSubmit)}
                  className="space-y-4"
                >
                  <FormField
                    control={deleteForm.control}
                    name="confirmName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("DeleteDialog.confirmLabelPrefix")}{" "}
                          <strong>{keyToDelete.name}</strong>{" "}
                          {t("DeleteDialog.confirmLabelSuffix")}
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {t("DeleteDialog.cancelButton")}
                    </AlertDialogCancel>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={deleteForm.formState.isSubmitting}
                    >
                      {t("DeleteDialog.deleteButton")}
                    </Button>
                  </AlertDialogFooter>
                </form>
              </Form>
            )}
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
