"use client";

import { useTranslations } from "next-intl";
import { useFormContext } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  GOOGLE_DISPLAY_LIMITS,
  type GoogleDisplayFormValues,
} from "@/lib/ads/google-display";

import { AdsDisplayImages } from "./ads-display-images";
import { AdsFormSection } from "./ads-form-section";
import { AdsFinalUrlField } from "./ads-google-search-fields";
import { AdsCharCount, AdsTextList } from "./ads-text-list";

type TextFieldName = "businessName" | "longHeadline";

function TextField({ max, name }: { max: number; name: TextFieldName }) {
  const t = useTranslations("App.Ads.newCampaign.ad");
  const form = useFormContext<GoogleDisplayFormValues>();
  const value = form.watch(name);

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(name)}</FormLabel>
          <div className="flex items-center gap-2">
            <FormControl>
              <Input autoComplete="off" {...field} />
            </FormControl>
            <span className="w-12 shrink-0 text-right">
              <AdsCharCount length={value.length} max={max} />
            </span>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * The Display campaign's own section, inside the create form: the responsive
 * display ad. It reads and writes the form around it.
 */
export function AdsGoogleDisplayFields() {
  const tSection = useTranslations("App.Ads.newCampaign.sections");

  return (
    <AdsFormSection id="new-campaign-ad" title={tSection("ad")}>
      <AdsFinalUrlField />
      <TextField max={GOOGLE_DISPLAY_LIMITS.businessName} name="businessName" />
      <AdsTextList
        limits={GOOGLE_DISPLAY_LIMITS.headlines}
        name="displayHeadlines"
      />
      <TextField max={GOOGLE_DISPLAY_LIMITS.longHeadline} name="longHeadline" />
      <AdsTextList
        limits={GOOGLE_DISPLAY_LIMITS.descriptions}
        name="displayDescriptions"
      />
      <AdsDisplayImages />
    </AdsFormSection>
  );
}
