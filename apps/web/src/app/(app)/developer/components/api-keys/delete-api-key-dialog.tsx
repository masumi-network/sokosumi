"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
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

import type {
  ApiKeyRecord,
  DeleteApiKeyDialogProps,
  DeleteApiKeyFormData,
} from "./types";
import { deleteApiKeySchema, validateConfirmationName } from "./utils";

function DeleteApiKeyDialogForm({
  apiKey,
  onOpenChange,
  onSuccess,
  deleteApiKey,
}: {
  apiKey: ApiKeyRecord;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  deleteApiKey: DeleteApiKeyDialogProps["deleteApiKey"];
}) {
  const t = useTranslations("App.Account.ApiKeys");
  const schema = deleteApiKeySchema(t);

  const form = useForm<DeleteApiKeyFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      keyId: apiKey.id,
      confirmName: "",
    },
  });

  const onSubmit = async (values: DeleteApiKeyFormData) => {
    const validation = validateConfirmationName(
      apiKey.name ?? "",
      values.confirmName,
      t,
    );

    if (!validation.isValid) {
      toast.error(validation.error);
      return;
    }

    const success = await deleteApiKey({ keyId: apiKey.id });

    if (success) {
      onOpenChange(false);
      onSuccess();
      form.reset();
    }
  };

  const confirmName = useWatch({
    control: form.control,
    name: "confirmName",
  });
  const canDelete = useMemo(() => {
    return confirmName === apiKey.name;
  }, [confirmName, apiKey.name]);

  const { isSubmitting } = form.formState;

  return (
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
          <AlertDialogCancel disabled={isSubmitting}>
            {t("DeleteDialog.cancelButton")}
          </AlertDialogCancel>
          <Button
            type="submit"
            variant="destructive"
            disabled={!canDelete}
            loading={isSubmitting}
          >
            {t("DeleteDialog.deleteButton")}
          </Button>
        </AlertDialogFooter>
      </form>
    </Form>
  );
}

export function DeleteApiKeyDialog({
  apiKey,
  open,
  onOpenChange,
  onSuccess,
  deleteApiKey,
}: DeleteApiKeyDialogProps) {
  const t = useTranslations("App.Account.ApiKeys");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("DeleteDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("DeleteDialog.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {apiKey && (
          <DeleteApiKeyDialogForm
            key={`${apiKey.id}-${open ? "open" : "closed"}`}
            apiKey={apiKey}
            onOpenChange={onOpenChange}
            onSuccess={onSuccess}
            deleteApiKey={deleteApiKey}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
