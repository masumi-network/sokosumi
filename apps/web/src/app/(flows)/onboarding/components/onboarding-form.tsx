"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

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
import { completeOnboarding, skipOnboarding } from "@/lib/actions/onboarding";
import { onboardingFormSchema, OnboardingFormSchemaType } from "@/lib/schemas";

// Validation utilities
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

export default function OnboardingForm() {
  const t = useTranslations("Onboarding.Form");
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);

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
    replace,
  } = useFieldArray({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    control: form.control as any,
    name: "emails",
  });

  // Initialize with 4 empty email fields using useLayoutEffect for faster sync
  useLayoutEffect(() => {
    if (emailFields.length === 0) {
      replace(["", "", "", ""]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Watch form values for validation state
  const watchedData = form.watch();
  const validEmails = normalizeEmails(watchedData.emails || []).filter(
    isValidEmail,
  );
  const hasValidEmails = validEmails.length > 0;
  const hasOrgName = watchedData.organizationName.trim().length > 0;
  const { errors } = form.formState;
  const hasFormErrors = Object.keys(errors).length > 0;

  // Button state logic
  const canSubmit = hasOrgName && hasValidEmails && !hasFormErrors;
  const isContinueDisabled = !canSubmit || isSubmitting || isSkipping;

  // Show add more button when 4th field is filled
  const shouldShowAddMore = watchedData.emails[3]?.trim().length > 0;

  // Helper text for disabled button
  const getButtonHelperText = (): string | null => {
    if (!isContinueDisabled || isSubmitting || isSkipping) return null;

    if (hasFormErrors) return t("Validation.fixErrors");

    if (!hasOrgName && !hasValidEmails) {
      return t("Validation.enterBoth");
    }
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
        router.push(result.data.redirectUrl ?? "/agents");
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
        router.push(result.data.redirectUrl ?? "/agents");
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
    <div className="space-y-8 p-6">
      {/* Step 1: Organization Name */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t("step1")}</h2>
        </div>
        <Form {...form}>
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
                      disabled={isSubmitting || isSkipping}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Form>
      </div>

      {/* Step 2: Invite Colleagues */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t("step2")}</h2>
        </div>

        <Form {...form}>
          <div className="space-y-3">
            {emailFields.map((field, index) => (
              <FormField
                key={field.id}
                control={form.control}
                name={`emails.${index}`}
                render={({ field }) => (
                  <FormItem>
                    <div className="relative">
                      <FormControl>
                        <Input
                          type="email"
                          placeholder={t("CoWorkers.placeholder")}
                          className="pr-28"
                          disabled={isSubmitting || isSkipping}
                          {...field}
                        />
                      </FormControl>
                      {isValidEmail(field.value || "") && index <= 3 && (
                        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-purple-500">
                          {t("credits")}
                        </span>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}

            {shouldShowAddMore && (
              <Button
                type="button"
                variant="link"
                className="w-full px-0"
                disabled={isSubmitting || isSkipping}
                onClick={() => appendEmail("")}
              >
                {t("inviteMoreCoWorkers")}
              </Button>
            )}
          </div>
        </Form>
      </div>

      {/* Actions */}
      {getButtonHelperText() && (
        <p className="mb-2 text-center text-xs text-gray-500">
          {getButtonHelperText()}
        </p>
      )}
      <div className="flex gap-4 pt-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex-1">
            <Button
              type="submit"
              variant="default"
              disabled={isContinueDisabled}
              className="w-full"
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("continueAndInviteCoWorkers")}
            </Button>
          </form>
        </Form>
      </div>

      <div className="flex items-center justify-between gap-2">
        <hr className="h-0 flex-1 border-0 border-t border-gray-200" />
        <span className="text-xs text-gray-400 uppercase">{t("divider")}</span>
        <hr className="h-0 flex-1 border-0 border-t border-gray-200" />
      </div>

      <Button
        variant="secondary"
        onClick={handleSkip}
        disabled={isSubmitting || isSkipping}
        className="w-full"
      >
        {t("skip")}
      </Button>
    </div>
  );
}
