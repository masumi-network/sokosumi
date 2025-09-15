"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
  const [additionalEmails, setAdditionalEmails] = useState<string[]>([]);

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
    })
    .superRefine((data, ctx) => {
      const emails = [data.email1, data.email2, data.email3, data.email4];
      const trimmedEmails = emails.map((e) => e.trim());
      const presentEmails = trimmedEmails.filter((e) => e.length > 0);
      const hasOrgName = data.organizationName.trim().length > 0;

      // Validate individual email formats when present
      trimmedEmails.forEach((email, index) => {
        if (email.length === 0) return;
        const parsed = z.string().email().safeParse(email);
        if (!parsed.success) {
          ctx.addIssue({
            code: "custom",
            message: "Invalid email",
            path: [emailFieldNames[index]],
          });
        }
      });

      const hasAnyValidEmail = presentEmails.some(
        (email) => z.string().email().safeParse(email).success,
      );

      // Cross-field validation: both required together when proceeding
      if (hasOrgName && !hasAnyValidEmail) {
        ctx.addIssue({
          code: "custom",
          message: "Add at least one valid colleague email to continue",
          path: ["email1"],
        });
      }
      if (!hasOrgName && presentEmails.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: "Organization name is required to invite colleagues",
          path: ["organizationName"],
        });
      }
    });

  type OnboardingFormData = z.infer<typeof onboardingFormSchema>;

  const form = useForm<OnboardingFormData>({
    resolver: zodResolver(onboardingFormSchema),
    defaultValues: {
      organizationName: "",
      email1: "",
      email2: "",
      email3: "",
      email4: "",
    },
    mode: "onChange",
  });

  const organizationName = form.watch("organizationName");
  const email1 = form.watch("email1");
  const email2 = form.watch("email2");
  const email3 = form.watch("email3");
  const email4 = form.watch("email4");

  const trimmedEmails = [email1, email2, email3, email4].map((e) =>
    (e ?? "").trim(),
  );
  const presentEmails = trimmedEmails.filter((e) => e.length > 0);
  const validEmails = presentEmails.filter(
    (email) => z.string().email().safeParse(email).success,
  );
  const hasValidEmails = validEmails.length > 0;
  const hasOrgName = (organizationName ?? "").trim().length > 0;
  const isFourthEmailFilled = (email4 ?? "").trim().length > 0;

  // Continue is enabled ONLY when we have org name AND at least one valid email
  const isContinueDisabled =
    !hasOrgName || !hasValidEmails || isSubmitting || isSkipping;

  const handleSubmit = async (values: OnboardingFormData) => {
    const currentEmails = [
      values.email1,
      values.email2,
      values.email3,
      values.email4,
    ]
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && z.string().email().safeParse(e).success);

    const extraEmails = additionalEmails
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && z.string().email().safeParse(e).success);

    const allEmails = [...currentEmails, ...extraEmails];

    if (!values.organizationName.trim() || allEmails.length === 0) return;

    setIsSubmitting(true);
    try {
      const result = await completeOnboarding(
        values.organizationName.trim(),
        allEmails,
      );

      if (result.ok) {
        toast.success(
          `Organization created and ${allEmails.length} invitation(s) sent.`,
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

            {additionalEmails.map((value, index) => (
              <div key={`extra-${index}`} className="relative">
                <Input
                  type="email"
                  placeholder={t("CoWorkers.placeholder")}
                  disabled={isSubmitting || isSkipping}
                  value={value}
                  onChange={(e) => {
                    const next = [...additionalEmails];
                    next[index] = e.target.value;
                    setAdditionalEmails(next);
                  }}
                />
              </div>
            ))}

            {isFourthEmailFilled && (
              <Button
                type="button"
                variant="link"
                className="w-full px-0"
                disabled={isSubmitting || isSkipping}
                onClick={() => setAdditionalEmails((prev) => [...prev, ""])}
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
