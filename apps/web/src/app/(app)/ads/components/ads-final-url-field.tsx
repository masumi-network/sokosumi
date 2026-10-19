"use client";

import { useTranslations } from "next-intl";
import { useFormContext } from "react-hook-form";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { GoogleSharedFormValues } from "@/lib/ads/google-campaign";

/** Where the ad leads: the same field for a Search and a Display ad. */
export function AdsFinalUrlField() {
  const t = useTranslations("App.Ads.newCampaign.ad");
  const form = useFormContext<GoogleSharedFormValues>();

  return (
    <FormField
      control={form.control}
      name="finalUrl"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t("finalUrl")}</FormLabel>
          <FormDescription>{t("finalUrlHelp")}</FormDescription>
          <FormControl>
            <Input
              autoCapitalize="off"
              autoComplete="off"
              inputMode="url"
              placeholder={t("finalUrlPlaceholder")}
              spellCheck={false}
              type="url"
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
