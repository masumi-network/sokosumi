"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useAuthCaptcha } from "@/components/auth-captcha";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useEmailChangeReturnNotice } from "@/hooks/effects/use-email-change-return-notice";
import { authClient } from "@/lib/auth/auth.client";
import type { EmailChangeStatus } from "@/lib/auth/auth.server";
import { type EmailFormSchemaType, emailFormSchema } from "@/lib/schemas/auth";

interface EmailFormProps {
  /** The address the account signs in with today. */
  currentEmail?: string;
  /** Core's record of the change; `null` when it could not be read. */
  emailChange?: EmailChangeStatus | null;
}

export function EmailForm({ currentEmail, emailChange }: EmailFormProps) {
  const pendingEmail = emailChange?.pending?.newEmail;
  const completedEmail = emailChange?.completed?.newEmail;
  const t = useTranslations("App.Account.Email");
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<
    "cancel" | "resend" | null
  >(null);
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("change-email");

  const form = useForm<EmailFormSchemaType>({
    resolver: zodResolver(
      emailFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: "",
    },
  });

  useEmailChangeReturnNotice({ completedEmail, currentEmail, t });

  const requestChange = async (newEmail: string) =>
    runWithCaptcha(async (fetchOptions) => {
      // Core's own change link, which can be shown and cancelled; its
      // confirmation returns to this page (`auth-pending-email-change.ts`).
      const changeEmailResult = await authClient.$fetch(
        "/email-change/request",
        { method: "POST", body: { newEmail }, headers: fetchOptions.headers },
      );

      if (changeEmailResult.error) {
        const errorMessage = getErrorMessage(
          changeEmailResult.error,
          changeEmailResult.error.message ?? t("error"),
        );
        toast.error(errorMessage);
      } else {
        // Only a link goes to the new address; the email changes when that
        // link is opened, so this is not a success yet.
        toast.success(t("success", { email: newEmail }));
        form.reset();
        router.refresh();
      }
    });

  const handleSubmit = async (values: EmailFormSchemaType) => {
    await requestChange(values.email);
  };

  const handleResend = async () => {
    if (!pendingEmail) return;
    setPendingAction("resend");
    try {
      await requestChange(pendingEmail);
    } finally {
      setPendingAction(null);
    }
  };

  const handleCancel = async () => {
    setPendingAction("cancel");
    try {
      const result = await authClient.$fetch<{ cancelled: boolean }>(
        "/email-change/cancel",
        { method: "POST", body: {} },
      );
      if (result.error) {
        toast.error(t("cancelError"));
        return;
      }
      // Nothing removed: a link already changed the email (or the request
      // expired), so say so instead of claiming a cancel.
      if (result.data.cancelled) {
        toast.success(t("cancelled"));
      } else {
        toast.error(t("cancelTooLate"));
      }
      router.refresh();
    } finally {
      setPendingAction(null);
    }
  };

  const { isSubmitting } = form.formState;

  return (
    <Card className="flex h-full flex-col">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <fieldset className="space-y-6" disabled={isSubmitting}>
            <CardHeader>
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>
                {currentEmail
                  ? t("descriptionWithCurrent", { email: currentEmail })
                  : t("description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {emailChange === null ? (
                <p className="text-muted-foreground text-sm">
                  {t("statusUnavailable")}
                </p>
              ) : null}
              {pendingEmail ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 text-sm font-medium break-all">
                      {pendingEmail}
                    </p>
                    <Badge variant="secondary">{t("pendingBadge")}</Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {t("pendingDescription")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleResend}
                      disabled={pendingAction !== null}
                      loading={pendingAction === "resend"}
                    >
                      {t("resend")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                      disabled={pendingAction !== null}
                      loading={pendingAction === "cancel"}
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("newEmail")}</FormLabel>
                    <FormControl>
                      <Input placeholder="mail@sokosumi.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </fieldset>
          {/* Outside the fieldset: its `disabled` would also disable the
              loading submit button, fading it and dropping focus. */}
          <CardFooter className="flex-col gap-4">
            {captcha}
            <Button type="submit" loading={isSubmitting} className="ms-auto">
              {t("submit")}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
