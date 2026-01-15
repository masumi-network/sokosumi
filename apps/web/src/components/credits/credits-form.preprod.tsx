"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Organization } from "@sokosumi/database";
import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

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
import {
  addPreprodCredits,
  CommonErrorCode,
  CreditsErrorCode,
} from "@/lib/actions";
import { fireGTMEvent } from "@/lib/gtm-events";

const preprodCreditsFormSchema = (t: IntlTranslation<"App.Credits">) =>
  z.object({
    credits: z.number().nullish().refine(
      (val) => val != null && val > 0,
      {
        message: t("Errors.invalidCredits"),
      },
    ),
  });

type PreprodCreditsFormData = z.infer<
  ReturnType<typeof preprodCreditsFormSchema>
>;

interface PreprodCreditsFormProps {
  organization: Organization | null;
}

export default function PreprodCreditsForm({
  organization,
}: PreprodCreditsFormProps) {
  const t = useTranslations("App.Credits");
  const router = useRouter();

  const form = useForm<PreprodCreditsFormData>({
    resolver: zodResolver(preprodCreditsFormSchema(t)),
    defaultValues: {
      credits: undefined,
    },
  });

  // Effect is necessary: Analytics tracking when component is displayed
  // Fires once on mount to track page view
  useEffect(() => {
    fireGTMEvent.viewCredits();
  }, []);

  const { setValue } = form;
  const credits = useWatch({
    control: form.control,
    name: "credits",
  });

  const handleSubmit = useCallback(
    async (data: PreprodCreditsFormData) => {
      if (!data.credits || data.credits <= 0) {
        toast.error(t("Errors.invalidCredits"));
        return;
      }

      const result = await addPreprodCredits({
        organizationId: organization?.id ?? null,
        credits: data.credits,
      });

      if (result.ok) {
        toast.success(t("preprodSuccess"));
        // Refresh the page to show updated credit balance
        router.refresh();
        // Reset form
        form.reset();
      } else {
        switch (result.error.code) {
          case CommonErrorCode.UNAUTHENTICATED:
            toast.error(t("Errors.unauthenticated"), {
              action: {
                label: t("Errors.unauthenticatedAction"),
                onClick: () => {
                  router.push(`/login`);
                },
              },
            });
            break;
          case CreditsErrorCode.INVALID_CREDITS:
            toast.error(t("Errors.invalidCredits"));
            break;
          case CommonErrorCode.UNAUTHORIZED:
            if (organization) {
              toast.error(t("Errors.unauthorizedOrganization"));
            } else {
              toast.error(t("Errors.unauthorizedPersonal"));
            }
            break;
          default:
            toast.error(t("Error.title"));
        }
      }
    },
    [router, t, organization, form],
  );

  const handleQuickAmount = useCallback(
    (amount: number) => {
      setValue("credits", amount);
    },
    [setValue],
  );

  const { isSubmitting } = form.formState;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("preprodTitle")}</CardTitle>
        <CardDescription>
          {organization ? (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {t("purchaseForOrganization", {
                organization: organization.name,
              })}
            </div>
          ) : (
            t("preprodDescription")
          )}
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[10, 25, 50, 100].map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant="outline"
                  onClick={() => handleQuickAmount(amount)}
                  disabled={isSubmitting}
                >
                  {t("creditAmount", { count: amount })}
                </Button>
              ))}
            </div>
            <FormField
              control={form.control}
              name="credits"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("creditsLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder={t("creditsPlaceholder")}
                      min="1"
                      max="10000"
                      disabled={isSubmitting}
                      {...field}
                      onChange={(e) => {
                        const { value } = e.target;
                        if (value === "") {
                          setValue("credits", undefined);
                        } else {
                          const numValue = Number(value);
                          if (Number.isFinite(numValue) && numValue >= 0) {
                            setValue("credits", numValue);
                          }
                        }
                      }}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex items-center justify-between pt-6">
            <Button
              type="submit"
              disabled={isSubmitting || !credits || credits <= 0}
            >
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {organization ? t("preprodTopUpButtonOrganization") : t("preprodTopUpButton")}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
