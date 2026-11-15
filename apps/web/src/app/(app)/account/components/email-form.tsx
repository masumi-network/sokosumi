"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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
import { authClient, changeEmail } from "@/lib/auth/auth.client";
import type { EmailChangeStatus } from "@/lib/auth/auth.server";
import { getAbsoluteAuthRedirectUrl } from "@/lib/auth/auth.utils";
import { type EmailFormSchemaType, emailFormSchema } from "@/lib/schemas/auth";

/** Marks the change link's return to this page; Better Auth adds `error`. */
const EMAIL_CHANGE_PARAM = "emailChange";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledReturnRef = useRef(false);
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

  // Only Core's completion record says the change went through: the query
  // flag just marks a return from the link, where Better Auth adds `error`.
  useEffect(() => {
    if (handledReturnRef.current) return;
    const changedTo =
      completedEmail && completedEmail === currentEmail?.toLowerCase()
        ? completedEmail
        : null;
    const returned = searchParams.has(EMAIL_CHANGE_PARAM);
    if (!changedTo && !returned) return;
    handledReturnRef.current = true;
    if (changedTo) {
      toast.success(t("changed", { email: changedTo }));
      void authClient.$fetch("/change-email/acknowledge", { method: "POST" });
    } else if (searchParams.has("error")) {
      toast.error(t("linkFailed"));
    }
    if (returned) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete(EMAIL_CHANGE_PARAM);
      nextParams.delete("error");
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }
  }, [completedEmail, currentEmail, pathname, router, searchParams, t]);

  const requestChange = async (newEmail: string) =>
    runWithCaptcha(async (fetchOptions) => {
      const changeEmailResult = await changeEmail({
        fetchOptions,
        newEmail,
        callbackURL: getAbsoluteAuthRedirectUrl(
          `/account?${EMAIL_CHANGE_PARAM}=1`,
        ),
      });

      if (changeEmailResult.error) {
        const errorMessage = getErrorMessage(
          changeEmailResult.error,
          changeEmailResult.error.message ?? t("error"),
        );
        toast.error(errorMessage);
      } else {
        // Better Auth only sends a link to the new address; the email changes
        // when that link is opened, so this is not a success yet.
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
      const result = await authClient.$fetch("/change-email/cancel", {
        method: "POST",
      });
      if (result.error) {
        toast.error(
          result.error.status === 409
            ? t("cancelInProgress")
            : t("cancelError"),
        );
        return;
      }
      toast.success(t("cancelled"));
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
            <Button type="submit" loading={isSubmitting} className="w-full">
              {t("submit")}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
