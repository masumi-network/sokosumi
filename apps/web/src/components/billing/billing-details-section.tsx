"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CommonErrorCode } from "@/lib/actions";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";
import {
  BILLING_COUNTRY_CODES,
  billingCountryRequiresState,
  getBillingCountryLabel,
  sortBillingCountryCodes,
} from "@/lib/constants/billing-countries";

const billingDetailsFormSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().length(2),
  taxIdValue: z.string().optional(),
});

type BillingDetailsFormData = z.infer<typeof billingDetailsFormSchema>;

export interface BillingDetailsSectionProps {
  billingDetails: StripeCustomerBillingDetails;
  canEdit: boolean;
  onSave: (data: {
    address: {
      line1: string;
      line2?: string | null;
      city: string;
      state?: string | null;
      postalCode: string;
      country: string;
    };
    taxIdValue?: string | null;
  }) => Promise<
    | { ok: true }
    | { ok: false; error: { code: string; message?: string | null } }
  >;
  translationNamespace:
    | "App.Account.BillingDetails"
    | "App.Organizations.OrganizationDetail.BillingDetails";
}

function getDefaultFormValues(
  billingDetails: StripeCustomerBillingDetails,
): BillingDetailsFormData {
  const primaryTaxId = billingDetails.taxIds[0];

  return {
    line1: billingDetails.address?.line1 ?? "",
    line2: billingDetails.address?.line2 ?? "",
    city: billingDetails.address?.city ?? "",
    state: billingDetails.address?.state ?? "",
    postalCode: billingDetails.address?.postalCode ?? "",
    country: billingDetails.address?.country ?? "DE",
    taxIdValue: primaryTaxId?.value ?? "",
  };
}

function formatAddressLine(
  billingDetails: StripeCustomerBillingDetails,
  locale: string,
): string | null {
  const { address } = billingDetails;
  if (!address) {
    return null;
  }

  const countryLabel = getBillingCountryLabel(address.country, locale);
  const locality = [address.postalCode, address.city].filter(Boolean).join(" ");
  const region = address.state ? `${address.state}, ` : "";

  return [
    address.line1,
    address.line2,
    `${locality}${locality ? ", " : ""}${region}${countryLabel}`,
  ]
    .filter((line) => line && line.trim().length > 0)
    .join("\n");
}

export function BillingDetailsSection({
  billingDetails,
  canEdit,
  onSave,
  translationNamespace,
}: BillingDetailsSectionProps) {
  const t = useTranslations(translationNamespace);
  const locale = useLocale();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const sortedCountries = useMemo(
    () => sortBillingCountryCodes(BILLING_COUNTRY_CODES, locale),
    [locale],
  );

  const form = useForm<BillingDetailsFormData>({
    resolver: zodResolver(billingDetailsFormSchema),
    defaultValues: getDefaultFormValues(billingDetails),
  });

  const selectedCountry = form.watch("country");
  const showStateField = billingCountryRequiresState(selectedCountry);
  const formattedAddress = formatAddressLine(billingDetails, locale);
  const primaryTaxId = billingDetails.taxIds[0];

  useEffect(() => {
    form.reset(getDefaultFormValues(billingDetails));
  }, [billingDetails, form]);

  const handleCancel = () => {
    form.reset(getDefaultFormValues(billingDetails));
    setIsEditing(false);
  };

  const onSubmit = async (data: BillingDetailsFormData) => {
    const result = await onSave({
      address: {
        line1: data.line1,
        line2: data.line2?.trim() ? data.line2 : null,
        city: data.city,
        state: data.state?.trim() ? data.state : null,
        postalCode: data.postalCode,
        country: data.country,
      },
      taxIdValue: data.taxIdValue?.trim() ? data.taxIdValue : null,
    });

    if (result.ok) {
      toast.success(t("Success.update"));
      setIsEditing(false);
      router.refresh();
      return;
    }

    switch (result.error.code) {
      case CommonErrorCode.UNAUTHENTICATED:
        toast.error(t("Errors.unauthenticated"), {
          action: {
            label: t("Errors.unauthenticatedAction"),
            onClick: async () => {
              router.push("/login");
            },
          },
        });
        break;
      case CommonErrorCode.UNAUTHORIZED:
        toast.error(t("Errors.unauthorized"));
        break;
      case CommonErrorCode.BAD_INPUT:
        toast.error(result.error.message ?? t("Errors.badInput"));
        break;
      default:
        toast.error(t("Errors.general"));
    }
  };

  const { isSubmitting } = form.formState;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="size-5" />
          <CardTitle>{t("title")}</CardTitle>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="line1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("line1Label")}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="address-line1"
                        disabled={isSubmitting}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="line2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("line2Label")}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="address-line2"
                        disabled={isSubmitting}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("cityLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="address-level2"
                          disabled={isSubmitting}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {showStateField ? (
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("stateLabel")}</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="address-level1"
                            disabled={isSubmitting}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
                <FormField
                  control={form.control}
                  name="postalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("postalCodeLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="postal-code"
                          disabled={isSubmitting}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("countryLabel")}</FormLabel>
                      <Select
                        disabled={isSubmitting}
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue
                              placeholder={t("countryPlaceholder")}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sortedCountries.map((countryCode) => (
                            <SelectItem key={countryCode} value={countryCode}>
                              {getBillingCountryLabel(countryCode, locale)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="taxIdValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("taxIdLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isSubmitting}
                        placeholder={t("taxIdPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>{t("taxIdHelp")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {t("save")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSubmitting}
                >
                  {t("cancel")}
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <div className="space-y-4">
            {formattedAddress ? (
              <p className="text-sm whitespace-pre-line">{formattedAddress}</p>
            ) : (
              <p className="text-muted-foreground text-sm">{t("empty")}</p>
            )}
            {primaryTaxId ? (
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">{t("taxIdLabel")}</p>
                <p>{primaryTaxId.value}</p>
                {primaryTaxId.verificationStatus ? (
                  <p className="text-muted-foreground text-xs">
                    {t("taxIdVerification", {
                      status: primaryTaxId.verificationStatus,
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
            {canEdit ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditing(true)}
              >
                {formattedAddress ? t("edit") : t("add")}
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
