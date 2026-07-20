"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";

import type {
  CreateOAuthClientDialogProps,
  CreateOAuthClientFormData,
} from "./types";
import {
  createOAuthClientSchema,
  DEFAULT_CREATE_FORM_VALUES,
  DIALOG_CLEANUP_TIMEOUT,
  parseRedirectUris,
} from "./utils";

interface ClientSecretFieldProps {
  secret: string;
  label: string;
  warning: string;
  copyLabel: string;
  showLabel: string;
  hideLabel: string;
  onCopy: (value: string) => Promise<void>;
}

function ClientSecretField({
  secret,
  label,
  warning,
  copyLabel,
  showLabel,
  hideLabel,
  onCopy,
}: ClientSecretFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-muted-foreground mb-2 text-xs">{warning}</p>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            type={isVisible ? "text" : "password"}
            value={secret}
            readOnly
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="font-mono pr-10 text-sm"
          />
          <button
            type="button"
            onClick={() => setIsVisible((value) => !value)}
            aria-label={isVisible ? hideLabel : showLabel}
            className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex items-center pr-3"
            tabIndex={-1}
          >
            {isVisible ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onCopy(secret)}
        >
          {copyLabel}
        </Button>
      </div>
    </div>
  );
}

export function CreateOAuthClientDialog({
  open,
  onOpenChange,
  onSuccess,
  createClient,
}: CreateOAuthClientDialogProps) {
  const t = useTranslations("App.Account.OAuthClients");
  const [createdCredentials, setCreatedCredentials] = useState<{
    clientId: string;
    clientSecret: string | null;
  } | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const schema = createOAuthClientSchema(t);

  const form = useForm<CreateOAuthClientFormData>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_CREATE_FORM_VALUES,
  });

  const { isSubmitting } = form.formState;

  const clearPendingCleanup = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const resetDialogState = () => {
    setCreatedCredentials(null);
    form.reset();
  };

  const onSubmit = async (values: CreateOAuthClientFormData) => {
    const result = await createClient({
      name: values.name,
      redirectUris: parseRedirectUris(values.redirectUris),
    });

    if (result.success && result.data) {
      setCreatedCredentials(result.data);
      onSuccess?.(result);
      form.reset();
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    clearPendingCleanup();

    if (nextOpen) {
      // Avoid re-showing prior credentials if reopened during close animation.
      resetDialogState();
      return;
    }

    // Delay form reset so close animation does not flash the empty form.
    // Credentials are cleared immediately to avoid secret re-display on reopen.
    setCreatedCredentials(null);
    timeoutRef.current = setTimeout(() => {
      form.reset();
      timeoutRef.current = null;
    }, DIALOG_CLEANUP_TIMEOUT);
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copySuccess"));
    } catch {
      toast.error(t("Messages.copyError"));
    }
  };

  useEffect(() => {
    return () => {
      clearPendingCleanup();
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {createdCredentials ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("CreatedSuccess.title")}</DialogTitle>
              <DialogDescription>
                {t("CreatedSuccess.description")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">
                  {t("CreatedSuccess.clientIdLabel")}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    value={createdCredentials.clientId}
                    readOnly
                    autoComplete="off"
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopy(createdCredentials.clientId)}
                  >
                    {t("copy")}
                  </Button>
                </div>
              </div>

              {createdCredentials.clientSecret ? (
                <ClientSecretField
                  secret={createdCredentials.clientSecret}
                  label={t("CreatedSuccess.clientSecretLabel")}
                  warning={t("CreatedSuccess.clientSecretWarning")}
                  copyLabel={t("copy")}
                  showLabel={t("CreatedSuccess.showSecret")}
                  hideLabel={t("CreatedSuccess.hideSecret")}
                  onCopy={handleCopy}
                />
              ) : null}

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
                        <Textarea
                          placeholder={t(
                            "CreateDialog.redirectUrisPlaceholder",
                          )}
                          className="min-h-20"
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
