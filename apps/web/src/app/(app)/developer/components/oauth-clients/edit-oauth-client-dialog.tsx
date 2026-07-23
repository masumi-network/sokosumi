"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  hasCoreApiOAuthScope,
  hasOfflineAccessOAuthScope,
} from "@sokosumi/utils";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DEFAULT_EDIT_FORM_VALUES,
  editOAuthClientSchema,
  parseRedirectUris,
} from "./utils";

export function EditOAuthClientDialog({
  client,
  open,
  onOpenChange,
  onSuccess,
  updateClient,
}: EditOAuthClientDialogProps) {
  const t = useTranslations("App.Account.OAuthClients");
  const schema = editOAuthClientSchema(t);

  const form = useForm<EditOAuthClientFormData>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_EDIT_FORM_VALUES,
  });

  useEffect(() => {
    if (client) {
      form.reset({
        name: client.client_name ?? "",
        redirectUris: (client.redirect_uris ?? []).join("\n"),
        includeCoreApi: hasCoreApiOAuthScope(client.scope),
        includeOfflineAccess: hasOfflineAccessOAuthScope(client.scope),
      });
    }
  }, [client, form]);

  const { isSubmitting } = form.formState;

  const onSubmit = async (values: EditOAuthClientFormData) => {
    if (!client) {
      return;
    }

    const success = await updateClient({
      clientId: client.client_id,
      name: values.name,
      redirectUris: parseRedirectUris(values.redirectUris),
      includeCoreApi: values.includeCoreApi,
      includeOfflineAccess: values.includeOfflineAccess,
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
              <div>
                <p className="text-sm font-medium">
                  {t("CreatedSuccess.clientIdLabel")}
                </p>
                <p className="text-muted-foreground mt-1 font-mono text-xs break-all">
                  {client.client_id}
                </p>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("EditDialog.nameLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("EditDialog.namePlaceholder")}
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
                    <FormLabel>{t("EditDialog.redirectUrisLabel")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("EditDialog.redirectUrisPlaceholder")}
                        className="min-h-20"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-muted-foreground text-xs">
                      {t("EditDialog.redirectUrisHelp")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="includeCoreApi"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-start gap-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked === true);
                          }}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <div className="space-y-1">
                        <FormLabel className="font-normal">
                          {t("EditDialog.includeCoreApiLabel")}
                        </FormLabel>
                        <FormDescription>
                          {t("EditDialog.includeCoreApiHelp")}
                        </FormDescription>
                      </div>
                    </div>
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
