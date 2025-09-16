"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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

interface OnboardingFormProps {
  userId: string;
}

export default function OnboardingForm({
  userId: _userId,
}: OnboardingFormProps) {
  const t = useTranslations("Onboarding.Form");

  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);

  const emailFieldNames = ["email1", "email2", "email3", "email4"] as const;

  function isValidEmail(value: string | undefined): boolean {
    const email = (value ?? "").trim();
    if (email.length === 0) return false;
    return z.string().email().safeParse(email).success;
  }

  const onboardingFormSchema = z
    .object({
      organizationName: z.string().trim(),
      email1: z.string().trim(),
      email2: z.string().trim(),
      email3: z.string().trim(),
      email4: z.string().trim(),
      extraEmails: z.array(z.object({ value: z.string().trim() })).default([]),
    })
    .superRefine((data, ctx) => {
      const baseEmails = [data.email1, data.email2, data.email3, data.email4];
      const extraEmails = (data.extraEmails ?? []).map((e) => e.value);

      const allEntries: Array<{
        value: string;
        path: (string | number)[];
      }> = [];
      baseEmails.forEach((value, index) => {
        allEntries.push({
          value: (value ?? "").trim(),
          path: [emailFieldNames[index]],
        });
      });
      extraEmails.forEach((value, index) => {
        allEntries.push({
          value: (value ?? "").trim(),
          path: ["extraEmails", index, "value"],
        });
      });

      const presentEntries = allEntries.filter((e) => e.value.length > 0);
      const hasOrgName = data.organizationName.trim().length > 0;

      // Validate individual email formats when present
      presentEntries.forEach(({ value, path }) => {
        const parsed = z.string().email().safeParse(value);
        if (!parsed.success) {
          ctx.addIssue({ code: "custom", message: "Invalid email", path });
        }
      });

      // Duplicate validation across all fields (case-insensitive)
      const lowerToPaths = new Map<string, (string | number)[][]>();
      presentEntries.forEach(({ value, path }) => {
        const key = value.toLowerCase();
        const list = lowerToPaths.get(key) ?? [];
        list.push(path);
        lowerToPaths.set(key, list);
      });
      for (const [, paths] of lowerToPaths) {
        if (paths.length > 1) {
          paths.forEach((path) => {
            ctx.addIssue({ code: "custom", message: "Duplicate email", path });
          });
        }
      }

      const hasAnyValidEmail = presentEntries.some(
        ({ value }) => z.string().email().safeParse(value).success,
      );

      // Cross-field validation: both required together when proceeding
      if (hasOrgName && !hasAnyValidEmail) {
        ctx.addIssue({
          code: "custom",
          message: "Add at least one valid colleague email to continue",
          path: ["email1"],
        });
      }
      if (!hasOrgName && presentEntries.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: "Organization name is required to invite colleagues",
          path: ["organizationName"],
        });
      }
    });

  type OnboardingFormInput = z.input<typeof onboardingFormSchema>;
  // Keeping the output type for future use if needed
  type _OnboardingFormData = z.output<typeof onboardingFormSchema>;

  const form = useForm<OnboardingFormInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(onboardingFormSchema as any),
    defaultValues: {
      organizationName: "",
      email1: "",
      email2: "",
      email3: "",
      email4: "",
      extraEmails: [],
    },
    mode: "onChange",
  });

  const { fields: extraEmailFields, append: appendExtraEmail } =
    useFieldArray<OnboardingFormInput>({
      control: form.control,
      name: "extraEmails",
    });

  const organizationName = form.watch("organizationName");
  const email1 = form.watch("email1");
  const email2 = form.watch("email2");
  const email3 = form.watch("email3");
  const email4 = form.watch("email4");
  const extraEmails = form.watch("extraEmails") ?? [];

  const trimmedEmails = [email1, email2, email3, email4].map((e) =>
    (e ?? "").trim(),
  );
  const extraTrimmed = (extraEmails as Array<{ value: string }>).map((e) =>
    (e?.value ?? "").trim(),
  );
  const presentEmails = [...trimmedEmails, ...extraTrimmed].filter(
    (e) => e.length > 0,
  );
  const validEmails = presentEmails.filter(
    (email) => z.string().email().safeParse(email).success,
  );
  const hasValidEmails = validEmails.length > 0;
  const _hasOrgName = (organizationName ?? "").trim().length > 0;
  const isFourthEmailFilled = (email4 ?? "").trim().length > 0;

  const hasDuplicateEmails = (() => {
    const lowered = presentEmails.map((e) => e.toLowerCase());
    return new Set(lowered).size !== lowered.length;
  })();

  // Disable when any error exists or when there is no valid email entered
  const hasFormErrors = Object.keys(form.formState.errors).length > 0;
  const isContinueDisabled =
    !hasValidEmails ||
    hasDuplicateEmails ||
    hasFormErrors ||
    isSubmitting ||
    isSkipping;

  const handleSubmit = async (values: OnboardingFormInput) => {
    const currentEmails = [
      values.email1,
      values.email2,
      values.email3,
      values.email4,
    ]
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && z.string().email().safeParse(e).success);

    const extra = (values.extraEmails ?? [])
      .map((e) => (e?.value ?? "").trim())
      .filter((e) => e.length > 0 && z.string().email().safeParse(e).success);

    const allEmails = [...currentEmails, ...extra];

    // Deduplicate while preserving original casing
    const seen = new Set<string>();
    const uniqueEmails: string[] = [];
    for (const email of allEmails) {
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueEmails.push(email);
    }

    if (!values.organizationName.trim() || uniqueEmails.length === 0) return;

    setIsSubmitting(true);
    try {
      const result = await completeOnboarding(
        values.organizationName.trim(),
        uniqueEmails,
      );

      if (result.ok) {
        toast.success(
          `Organization created and ${uniqueEmails.length} invitation(s) sent.`,
        );
        router.push(result.data.redirectUrl ?? "/agents");
      } else {
        toast.error(result.error.message ?? "Failed to complete onboarding");
      }
    } catch (_error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = async () => {
    setIsSkipping(true);
    try {
      const result = await skipOnboarding();
      if (result.ok) {
        router.push(result.data.redirectUrl ?? "/agents");
      } else {
        toast.error(result.error.message ?? "Failed to skip onboarding");
      }
    } catch (_error) {
      toast.error("An unexpected error occurred");
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
          {/* Field-level messages will show inline below each input */}
        </div>

        <Form {...form}>
          <div className="space-y-3">
            {emailFieldNames.map((name) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
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
                      {isValidEmail(field.value) && (
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

            {extraEmailFields.map((field, index) => (
              <FormField
                key={field.id}
                control={form.control}
                name={`extraEmails.${index}.value`}
                render={({ field }) => (
                  <FormItem>
                    <div className="relative">
                      <FormControl>
                        <Input
                          type="email"
                          placeholder={t("CoWorkers.placeholder")}
                          disabled={isSubmitting || isSkipping}
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}

            {isFourthEmailFilled && (
              <Button
                type="button"
                variant="link"
                className="w-full px-0"
                disabled={isSubmitting || isSkipping}
                onClick={() => appendExtraEmail({ value: "" })}
              >
                {t("inviteMoreCoWorkers")}
              </Button>
            )}
          </div>
        </Form>
      </div>

      {/* Actions */}
      <div className="flex gap-4 pt-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex-1">
            <Button
              type="submit"
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
        variant="ghost"
        onClick={handleSkip}
        disabled={isSubmitting || isSkipping}
        className="w-full"
      >
        {t("skip")}
      </Button>
    </div>
  );
}
