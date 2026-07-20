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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { CredentialsOnceDisplay } from "./credentials-once-display";
import type {
  CreatedOAuthClientCredentials,
  CreateOAuthClientDialogProps,
  CreateOAuthClientFormData,
} from "./types";
import {
  createOAuthClientSchema,
  DEFAULT_CREATE_FORM_VALUES,
  parseRedirectUris,
} from "./utils";

export function CreateOAuthClientDialog({
  open,
  onOpenChange,
  onSuccess,
  createClient,
}: CreateOAuthClientDialogProps) {
  const t = useTranslations("App.Developer.OAuthClients");
  const [createdCredentials, setCreatedCredentials] =
    useState<CreatedOAuthClientCredentials | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const schema = createOAuthClientSchema(t);

  const form = useForm<CreateOAuthClientFormData>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_CREATE_FORM_VALUES,
  });

  const { isSubmitting } = form.formState;

  const onSubmit = async (values: CreateOAuthClientFormData) => {
    const result = await createClient({
      name: values.name,
      redirectUris: parseRedirectUris(values.redirectUris),
    });

    if (result.success && result.data) {
      setCreatedCredentials(result.data);
      onSuccess(result);
      form.reset();
    }
  };

  const isCredentialsOnce = createdCredentials !== null;

  const handleOpenChange = (nextOpen: boolean) => {
    // Block Esc/outside/X while one-time secret is visible — Done only.
    if (!nextOpen && isCredentialsOnce) return;

    onOpenChange(nextOpen);
    if (!nextOpen) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setCreatedCredentials(null);
        form.reset();
        timeoutRef.current = null;
      }, 300);
    }
  };

  const handleSuccessClose = () => {
    setCreatedCredentials(null);
    onOpenChange(false);
    form.reset();
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
      <DialogContent
        className={isCredentialsOnce ? "[&>button]:hidden" : undefined}
        onEscapeKeyDown={
          isCredentialsOnce ? (event) => event.preventDefault() : undefined
        }
        onPointerDownOutside={
          isCredentialsOnce ? (event) => event.preventDefault() : undefined
        }
        onInteractOutside={
          isCredentialsOnce ? (event) => event.preventDefault() : undefined
        }
      >
        {createdCredentials ? (
          <CredentialsOnceDisplay
            credentials={createdCredentials}
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

                <FormField
                  control={form.control}
                  name="redirectUris"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("CreateDialog.redirectUrisLabel")}
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t(
                            "CreateDialog.redirectUrisPlaceholder",
                          )}
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
                    {t("CreateDialog.cancelButton")}
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
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
