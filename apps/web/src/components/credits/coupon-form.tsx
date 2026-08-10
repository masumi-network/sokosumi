"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
  CommonErrorCode,
  CreditsErrorCode,
  claimFreeCreditsWithCoupon,
} from "@/lib/actions";
import type { Organization } from "@/lib/clients/generated/core";
import { fireGTMEvent } from "@/lib/gtm-events";

const couponFormSchema = (t: IntlTranslation<"App.Credits">) =>
  z.object({
    coupon: z
      .string()
      .trim()
      .min(1, {
        message: t("Errors.invalidCoupon"),
      }),
  });

type CouponFormData = z.infer<ReturnType<typeof couponFormSchema>>;

interface CouponFormProps {
  organization: Organization | null;
  returnPath?: string;
}

export default function CouponForm({
  organization,
  returnPath,
}: CouponFormProps) {
  const t = useTranslations("App.Credits");
  const router = useRouter();

  const form = useForm<CouponFormData>({
    resolver: zodResolver(couponFormSchema(t)),
    defaultValues: {
      coupon: "",
    },
  });

  useEffect(() => {
    fireGTMEvent.viewCredits();
  }, []);

  const { isSubmitting } = form.formState;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("couponPageTitle")}</CardTitle>
        <CardDescription>
          {organization ? (
            <div className="flex items-center gap-2">
              <Building2 className="size-4" />
              {t("purchaseForOrganization", {
                organization: organization.name,
              })}
            </div>
          ) : (
            t("couponPageDescription")
          )}
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(async (data) => {
            const result = await claimFreeCreditsWithCoupon({
              organizationId: organization?.id ?? null,
              couponId: data.coupon,
              returnPath,
            });

            if (result.ok) {
              fireGTMEvent.beginCheckout();
              window.location.assign(result.value.url);
              return;
            }

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
              case CreditsErrorCode.INVALID_COUPON:
                toast.error(t("Errors.invalidCoupon"));
                break;
              case CreditsErrorCode.COUPON_NOT_FOUND:
                toast.error(t("Errors.couponNotFound"));
                break;
              case CreditsErrorCode.COUPON_TYPE_ERROR:
                toast.error(t("Errors.couponTypeError"));
                break;
              case CreditsErrorCode.COUPON_CURRENCY_ERROR:
                toast.error(t("Errors.couponCurrencyError"));
                break;
              case CreditsErrorCode.PROMOTION_CODE_NOT_FOUND:
                toast.error(t("Errors.promotionCodeNotFound"));
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
          })}
        >
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="coupon"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("couponLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder={t("couponPlaceholder")}
                      autoComplete="off"
                      disabled={isSubmitting}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex items-end justify-between gap-4 pt-6">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {organization ? t("couponButtonOrganization") : t("couponButton")}
            </Button>
            <p className="text-muted-foreground text-right text-xs">
              {t("couponExpiryPolicyNotice")}
            </p>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
