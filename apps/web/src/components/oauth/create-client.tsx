"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/auth.client";

const createOAuthClientSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be less than 100 characters"),
  redirectUris: z
    .string()
    .min(1, "At least one redirect URI is required")
    .refine(
      (value) => {
        const uris = value
          .split("\n")
          .map((uri) => uri.trim())
          .filter((uri) => uri.length > 0);
        return (
          uris.length > 0 &&
          uris.every((uri) => {
            try {
              new URL(uri);
              return true;
            } catch {
              return false;
            }
          })
        );
      },
      {
        message: "Each redirect URI must be a valid URL",
      },
    ),
});

type CreateOAuthClientFormData = z.infer<typeof createOAuthClientSchema>;

interface CreateOAuthClientProps {
  onSuccess?: () => void;
}

export function CreateOAuthClient({ onSuccess }: CreateOAuthClientProps) {
  const t = useTranslations("App.Account.OAuthClients");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdClient, setCreatedClient] = useState<{
    clientId: string;
    clientSecret: string | null;
  } | null>(null);

  const form = useForm<CreateOAuthClientFormData>({
    resolver: zodResolver(createOAuthClientSchema),
    defaultValues: {
      name: "",
      redirectUris: "",
    },
  });

  const onSubmit = async (values: CreateOAuthClientFormData) => {
    setIsSubmitting(true);
    try {
      const redirectUris = values.redirectUris
        .split("\n")
        .map((uri) => uri.trim())
        .filter((uri) => uri.length > 0);

      const result = await authClient.oauth2.createClient({
        redirect_uris: redirectUris,
        client_name: values.name,
      });
      console.log(result);
      if (result.error) {
        throw new Error(result.error.message || t("createError"));
      }

      if (result.data) {
        setCreatedClient({
          clientId: result.data.client_id,
          clientSecret: result.data.client_secret || null,
        });
        toast.success(t("createSuccess"));
        form.reset();
        onSuccess?.();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t("createError");
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset form and created client when closing
      setTimeout(() => {
        form.reset();
        setCreatedClient(null);
      }, 300);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline">
        {t("createButton")}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          {createdClient ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("CreatedSuccess.title")}</DialogTitle>
                <DialogDescription>
                  {t("CreatedSuccess.description")}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">
                    {t("CreatedSuccess.clientIdLabel")}
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      value={createdClient.clientId}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(createdClient.clientId);
                        toast.success(t("copySuccess"));
                      }}
                    >
                      {t("copy")}
                    </Button>
                  </div>
                </div>

                {createdClient.clientSecret && (
                  <div>
                    <label className="text-sm font-medium">
                      {t("CreatedSuccess.clientSecretLabel")}
                    </label>
                    <p className="text-muted-foreground mb-2 text-xs">
                      {t("CreatedSuccess.clientSecretWarning")}
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        value={createdClient.clientSecret}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            createdClient.clientSecret!,
                          );
                          toast.success(t("copySuccess"));
                        }}
                      >
                        {t("copy")}
                      </Button>
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button onClick={() => handleOpenChange(false)}>
                    {t("CreatedSuccess.doneButton")}
                  </Button>
                </DialogFooter>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("CreateDialog.title")}</DialogTitle>
                <DialogDescription>
                  {t("CreateDialog.description")}
                </DialogDescription>
              </DialogHeader>

              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
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

                  <FormField
                    control={form.control}
                    name="redirectUris"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("CreateDialog.redirectUrisLabel")}
                        </FormLabel>
                        <FormControl>
                          <textarea
                            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder={t(
                              "CreateDialog.redirectUrisPlaceholder",
                            )}
                            {...field}
                          />
                        </FormControl>
                        <p className="text-muted-foreground text-xs">
                          {t("CreateDialog.redirectUrisHelp")}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleOpenChange(false)}
                      disabled={isSubmitting}
                    >
                      {t("CreateDialog.cancelButton")}
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {t("CreateDialog.createButton")}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
