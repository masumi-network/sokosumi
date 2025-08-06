"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { DeleteApiKeyDialogProps, DeleteApiKeyFormData } from "./types";
import {
  DEFAULT_DELETE_FORM_VALUES,
  deleteApiKeySchema,
  validateConfirmationName,
} from "./utils";

/**
 * Dialog component for confirming API key deletion
 * Requires user to type the API key name for confirmation
 */
export function DeleteApiKeyDialog({
  apiKey,
  open,
  onOpenChange,
  onSuccess,
  deleteApiKey,
}: DeleteApiKeyDialogProps) {
  const t = useTranslations("App.Account.ApiKeys");

  const schema = deleteApiKeySchema(t);

  const form = useForm<DeleteApiKeyFormData>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_DELETE_FORM_VALUES,
  });

  /**
   * Handle form submission to delete API key
   */
  const onSubmit = async (values: DeleteApiKeyFormData) => {
    if (!apiKey) return;

    // Verify the confirmation name matches
    const validation = validateConfirmationName(
      apiKey.name ?? "",
      values.confirmName,
      t,
    );

    if (!validation.isValid) {
      toast.error(validation.error);
      return;
    }

    // Attempt to delete the API key
    const success = await deleteApiKey({ keyId: apiKey.id });

    if (success) {
      onOpenChange(false);
      onSuccess();
      form.reset();
    }
    // Error handling is done in the hook via toast
  };

  /**
   * Handle dialog close - reset form
   */
  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      form.reset();
    }
  };

  // Reset form when apiKey changes
  React.useEffect(() => {
    if (apiKey) {
      form.reset({
        keyId: apiKey.id,
        confirmName: "",
      });
    }
  }, [apiKey, form]);

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("DeleteDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("DeleteDialog.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {apiKey && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="confirmName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("DeleteDialog.confirmLabelPrefix")}{" "}
                      <strong>{apiKey.name}</strong>{" "}
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
                  disabled={form.formState.isSubmitting}
                >
                  {t("DeleteDialog.deleteButton")}
                </Button>
              </AlertDialogFooter>
            </form>
          </Form>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
