"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type {
  EditOAuthClientDialogProps,
  EditOAuthClientFormData,
} from "./types";
import {
  editOAuthClientSchema,
  parseRedirectUris,
  redirectUrisToTextareaValue,
} from "./utils";

export function EditOAuthClientDialog({
  client,
  open,
  onOpenChange,
  onSuccess,
  updateClient,
}: EditOAuthClientDialogProps) {
  const t = useTranslations("App.Developer.OAuthClients");
  const schema = editOAuthClientSchema(t);

  const form = useForm<EditOAuthClientFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      redirectUris: "",
    },
  });

  useEffect(() => {
    if (client) {
      form.reset({
        name: client.client_name ?? "",
        redirectUris: redirectUrisToTextareaValue(client.redirect_uris),
      });
    }
  }, [client, form]);

  const onSubmit = async (values: EditOAuthClientFormData) => {
    if (!client) {
      return;
    }

    const success = await updateClient({
      clientId: client.client_id,
      name: values.name,
      redirectUris: parseRedirectUris(values.redirectUris),
    });

    if (success) {
      onOpenChange(false);
      onSuccess();
      form.reset();
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      form.reset();
    }
  };

  const { isSubmitting } = form.formState;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("EditDialog.title")}</DialogTitle>
          <DialogDescription>{t("EditDialog.description")}</DialogDescription>
        </DialogHeader>

        {client ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                    <FormLabel>{t("CreateDialog.redirectUrisLabel")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("CreateDialog.redirectUrisPlaceholder")}
                        className="min-h-24"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("CreateDialog.redirectUrisHelp")}
                    </FormDescription>
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
                  {t("EditDialog.cancelButton")}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {t("EditDialog.saveButton")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
