"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import { Building2, Loader2, Mail, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { completeOnboarding, skipOnboarding } from "@/lib/actions/onboarding";
import { onboardingFormSchema, OnboardingFormSchemaType } from "@/lib/schemas";

const emailSchema = z.email();
const isValidEmail = (email: string): boolean => {
  const trimmed = email.trim();
  return trimmed.length > 0 && emailSchema.safeParse(trimmed).success;
};

const normalizeEmails = (emails: string[]): string[] => {
  return emails
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
};

const deduplicateEmails = (emails: string[]): string[] =>
  Array.from(new Set(emails));

interface OnboardingFormProps {
  onComplete?: (redirectUrl: string) => void;
}

export default function OnboardingForm({ onComplete }: OnboardingFormProps) {
  const t = useTranslations("Onboarding.Form");
  const tApp = useTranslations("App");
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const isBusy = isSubmitting || isSkipping;

  const form = useForm<OnboardingFormSchemaType>({
    resolver: zodResolver(onboardingFormSchema(t)),
    defaultValues: {
      organizationName: "",
      emails: [],
    },
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  const {
    fields: emailFields,
    append: appendEmail,
    remove,
    replace,
  } = useFieldArray({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    control: form.control as any,
    name: "emails",
  });

  useLayoutEffect(() => {
    if (emailFields.length === 0) {
      replace(["", "", "", ""]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const watchedData = form.watch();
  const validEmails = normalizeEmails(watchedData.emails || []).filter(
    isValidEmail,
  );
  const hasValidEmails = validEmails.length > 0;
  const hasOrgName = watchedData.organizationName.trim().length > 0;
  const { errors } = form.formState;
  const hasFormErrors = Object.keys(errors).length > 0;
  const visibleCreditsCount = Math.min(validEmails.length, 4);

  const canSubmit = hasOrgName && hasValidEmails && !hasFormErrors;
  const isContinueDisabled = !canSubmit || isBusy;

  const shouldShowAddMore = watchedData.emails[3]?.trim().length > 0;

  const getButtonHelperText = (): string | null => {
    if (!isContinueDisabled || isBusy) return null;
    if (hasFormErrors) return t("Validation.fixErrors");
    if (!hasOrgName && !hasValidEmails) return t("Validation.enterBoth");
    if (!hasOrgName) return t("Validation.enterOrgName");
    if (!hasValidEmails) return t("Validation.addValidEmail");
    return null;
  };

  const handleSubmit = async (values: OnboardingFormSchemaType) => {
    const validEmails = normalizeEmails(values.emails).filter(isValidEmail);
    const uniqueEmails = deduplicateEmails(validEmails);

    if (!values.organizationName.trim() || uniqueEmails.length === 0) return;

    track("Onboarding submitted", { emailsCount: uniqueEmails.length });
    setIsSubmitting(true);

    try {
      const result = await completeOnboarding(
        values.organizationName.trim(),
        uniqueEmails,
      );

      if (result.ok) {
        toast.success(
          t("Toast.organizationCreated", { count: uniqueEmails.length }),
        );
        const redirectUrl = result.data.redirectUrl ?? "/agents";
        if (onComplete) {
          onComplete(redirectUrl);
        } else {
          router.push(redirectUrl);
        }
      } else {
        toast.error(result.error.message ?? t("Toast.failedToComplete"));
      }
    } catch {
      toast.error(t("Toast.unexpectedError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = async () => {
    track("Onboarding skipped");
    setIsSkipping(true);

    try {
      const result = await skipOnboarding();
      if (result.ok) {
        const redirectUrl = result.data.redirectUrl ?? "/agents";
        if (onComplete) {
          onComplete(redirectUrl);
        } else {
          router.push(redirectUrl);
        }
      } else {
        toast.error(result.error.message ?? t("Toast.failedToSkip"));
      }
    } catch {
      toast.error(t("Toast.unexpectedError"));
    } finally {
      setIsSkipping(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
        <section className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t("step1")}
              </p>
              <h2 className="text-lg font-semibold">
                {t("createYourOrganisation")}
              </h2>
            </div>
            <span className="bg-muted text-muted-foreground inline-flex size-9 items-center justify-center rounded-lg border">
              <Building2 className="size-4" />
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="organization">{t("Organisation.name")}</Label>
            <FormField
              control={form.control}
              name="organizationName"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      id="organization"
                      type="text"
                      placeholder={t("Organisation.placeholder")}
                      disabled={isBusy}
                      className="h-10"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t("step2")}
              </p>
              <h2 className="text-lg font-semibold">{t("inviteCoWorkers")}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-mono tabular-nums">
                {visibleCreditsCount}/4
              </Badge>
              <span className="bg-muted text-muted-foreground inline-flex size-9 items-center justify-center rounded-lg border">
                <Mail className="size-4" />
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {emailFields.map((emailField, index) => (
              <FormField
                key={emailField.id}
                control={form.control}
                name={`emails.${index}`}
                render={({ field }) => {
                  const value = field.value ?? "";
                  const showCredits = isValidEmail(value) && index < 4;
                  const canRemoveField = index >= 4;

                  return (
                    <FormItem>
                      <div className="relative">
                        <FormControl>
                          <Input
                            type="email"
                            placeholder={t("CoWorkers.placeholder")}
                            className={
                              canRemoveField ? "h-10 pr-10" : "h-10 pr-28"
                            }
                            disabled={isBusy}
                            {...field}
                            value={value}
                          />
                        </FormControl>
                        <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
                          {showCredits ? (
                            <span className="text-primary hidden text-xs font-medium sm:inline">
                              {t("credits")}
                            </span>
                          ) : null}
                          {canRemoveField ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={isBusy}
                              className="pointer-events-auto size-7 rounded-md"
                              onClick={() => remove(index)}
                            >
                              <X className="size-4" />
                              <span className="sr-only">{tApp("delete")}</span>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            ))}

            {shouldShowAddMore ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={isBusy}
                onClick={() => appendEmail("")}
              >
                <Plus className="size-4" />
                {t("inviteMoreCoWorkers")}
              </Button>
            ) : null}
          </div>
        </section>

        <section className="space-y-4 border-t pt-6">
          {getButtonHelperText() ? (
            <p className="text-muted-foreground text-center text-xs">
              {getButtonHelperText()}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            disabled={isContinueDisabled}
            className="h-10 w-full"
          >
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("continueAndInviteCoWorkers")}
          </Button>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-muted-foreground text-xs uppercase">
              {t("divider")}
            </span>
            <Separator className="flex-1" />
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={handleSkip}
            disabled={isBusy}
            className="h-10 w-full"
          >
            {t("skip")}
          </Button>
        </section>
      </form>
    </Form>
  );
}
