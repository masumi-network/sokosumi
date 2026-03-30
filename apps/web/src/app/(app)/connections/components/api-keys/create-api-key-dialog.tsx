"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { ApiKeySuccessDisplay } from "./api-key-success-display";
import type { CreateApiKeyDialogProps, CreateApiKeyFormData } from "./types";
import { createApiKeySchema, DEFAULT_CREATE_FORM_VALUES } from "./utils";

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onSuccess,
  createApiKey,
}: CreateApiKeyDialogProps) {
  const t = useTranslations("App.Account.ApiKeys");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const schema = createApiKeySchema(t);

  const form = useForm<CreateApiKeyFormData>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_CREATE_FORM_VALUES,
  });

  const { isSubmitting } = form.formState;

  const onSubmit = async (values: CreateApiKeyFormData) => {
    const result = await createApiKey({
      name: values.name,
    });

    if (result.success && result.data) {
      setCreatedKey(result.data.key);
      onSuccess(result);
      form.reset();
    }
  };

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setCreatedKey(null);
        form.reset();
        timeoutRef.current = null;
      }, 300);
    }
  };

  const handleSuccessClose = () => {
    handleOpenChange(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {createdKey ? (
          <ApiKeySuccessDisplay
            apiKey={createdKey}
            onClose={handleSuccessClose}
          />
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
  );
}
