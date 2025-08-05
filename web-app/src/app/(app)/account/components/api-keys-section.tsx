"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
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

// Schemas for form validation
const createApiKeySchema = z.object({
  name: z
    .string()
    .min(1, "API key name is required")
    .max(100, "API key name must be less than 100 characters")
    .regex(
      /^[a-zA-Z0-9\s\-_]+$/,
      "API key name can only contain letters, numbers, spaces, hyphens, and underscores",
    ),
});

const deleteApiKeySchema = z.object({
  keyId: z.string().min(1, "API key ID is required"),
  confirmName: z.string().min(1, "Please confirm the API key name"),
});

type CreateApiKeyType = z.infer<typeof createApiKeySchema>;
type DeleteApiKeyType = z.infer<typeof deleteApiKeySchema>;

export function ApiKeysSection() {
  const [apiKeys, setApiKeys] = useState<Apikey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<Apikey | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

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
  const loadApiKeys = async () => {
    setLoading(true);
    try {
      const result = await authClient.apiKey.list();

      if (result.data) {
        setApiKeys(result.data as Apikey[]);
        setCurrentPage(1); // Reset to first page when reloading
      } else {
        toast.error("Failed to load API keys");
      }
    } catch (_error) {
      toast.error("Failed to load API keys");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadApiKeys();
  }, []);

  // Handle create API key
  const onCreateSubmit = async (values: CreateApiKeyType) => {
    try {
      const result = await authClient.apiKey.create({
        name: values.name,
      });

      if (result.data) {
        setCreatedKey(result.data.key);
        toast.success("API key created successfully");
        createForm.reset();
        await loadApiKeys();
      } else {
        toast.error(result.error?.message ?? "Failed to create API key");
      }
    } catch (_error) {
      toast.error("Failed to create API key");
    }
  };

  // Handle delete API key
  const onDeleteSubmit = async (values: DeleteApiKeyType) => {
    if (!keyToDelete) return;

    // Verify the confirmation name matches
    if (keyToDelete.name !== values.confirmName) {
      toast.error("The confirmation name does not match");
      return;
    }

    try {
      const result = await authClient.apiKey.delete({
        keyId: keyToDelete.id,
      });

      if (result.data) {
        toast.success("API key deleted successfully");
        setDeleteDialogOpen(false);
        setKeyToDelete(null);
        deleteForm.reset();
        await loadApiKeys();
      } else {
        toast.error(result.error?.message ?? "Failed to delete API key");
      }
    } catch (_error) {
      toast.error("Failed to delete API key");
    }
  };

  // Handle copy to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 3000);
    } catch (_error) {
      toast.error("Failed to copy to clipboard");
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
            <CardTitle>{"API Keys"}</CardTitle>
            <CardDescription>
              {"Manage your API keys for programmatic access"}
            </CardDescription>
          </div>
          <Dialog
            open={createDialogOpen}
            onOpenChange={(open) => {
              setCreateDialogOpen(open);
              if (!open) {
                // Reset all state when dialog closes
                setTimeout(() => {
                  setCreatedKey(null);
                  setCopiedKey(false);
                }, 300);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                {"Create"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              {!createdKey && (
                <DialogHeader>
                  <DialogTitle>{"Create New API Key"}</DialogTitle>
                  <DialogDescription>
                    {
                      "Give your API key a descriptive name to help you identify it later."
                    }
                  </DialogDescription>
                </DialogHeader>
              )}
              {createdKey ? (
                <>
                  <DialogHeader>
                    <DialogTitle>{"New API Key Created"}</DialogTitle>
                    <DialogDescription>
                      {"Your new API key has been created successfully."}
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
                          setTimeout(() => {
                            setCreatedKey(null);
                            setCopiedKey(false);
                          }, 300);
                        }}
                      >
                        {"Done"}
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
                          <FormLabel>{"Name"}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., Production Server, Development App"
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
                        {"Cancel"}
                      </Button>
                      <Button
                        type="submit"
                        disabled={createForm.formState.isSubmitting}
                      >
                        {"Create API Key"}
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
            {"Loading API keys..."}
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            {"No API keys found. Create your first API key to get started."}
          </div>
        ) : (
          <div className="space-y-4">
            <ScrollArea>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{"Name"}</TableHead>
                    <TableHead>{"Key"}</TableHead>
                    <TableHead>{"Created"}</TableHead>
                    <TableHead>{"Status"}</TableHead>
                    <TableHead className="w-[100px]">{"Actions"}</TableHead>
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
                        {new Date(apiKey.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            apiKey.enabled
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {apiKey.enabled ? "Active" : "Disabled"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteClick(apiKey)}
                        >
                          <Trash2 className="text-destructive h-4 w-4" />
                        </Button>
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
                  {`Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, apiKeys.length)} of ${apiKeys.length}`}
                </p>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePreviousPage}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">
                    {`Page ${currentPage} of ${totalPages}`}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                  >
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
              <AlertDialogTitle>{"Delete API Key"}</AlertDialogTitle>
              <AlertDialogDescription>
                {
                  "This action cannot be undone. This will permanently delete the API key and any applications using it will no longer be able to access your account."
                }
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
                          {"Type "}
                          <strong>{keyToDelete.name}</strong>
                          {" to confirm deletion:"}
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>{"Cancel"}</AlertDialogCancel>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={deleteForm.formState.isSubmitting}
                    >
                      {"Delete API Key"}
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
