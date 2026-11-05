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
import { Textarea } from "@/components/ui/textarea";
import type { GoogleSharedFormValues } from "@/lib/ads/google-campaign";
import {
  appendBroadKeywords,
  GOOGLE_KEYWORD_LIMIT,
  parseGoogleKeywords,
} from "@/lib/ads/google-keywords";
import {
  adDisplayUrl,
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchFormValues,
} from "@/lib/ads/google-search";
import { cn } from "@/lib/utils";

import { AdsAddMarketKeywords } from "./ads-add-market-keywords";
import { AdsFinalUrlField } from "./ads-final-url-field";
import {
  AdsCalloutsSection,
  AdsSitelinksSection,
} from "./ads-search-assets-fields";
import { AdsSection } from "./ads-section";
import { AdsTextList } from "./ads-text-list";

interface AdsGoogleSearchFieldsProps {
  projectId: string;
  /** Whether "Add from Market" has keywords to draw on. */
  hasMarketProfile: boolean;
}

/**
 * The optional dates, which close the Basics section. A campaign that has
 * started keeps its start date: `startDateHint` says why, and the field stays
 * readable and focusable but cannot change.
 */
export function AdsGoogleDateFields({
  startDateHint,
}: {
  startDateHint?: string | undefined;
}) {
  const t = useTranslations("App.Ads.newCampaign");
  const form = useFormContext<GoogleSharedFormValues>();

  return (
    <div className="grid gap-2">
      <div className="grid gap-4 sm:grid-cols-2">
        {(["startDate", "endDate"] as const).map((name) => (
          <FormField
            control={form.control}
            key={name}
            name={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(name)}</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    {...field}
                    readOnly={name === "startDate" && !!startDateHint}
                  />
                </FormControl>
                {name === "startDate" && startDateHint ? (
                  <FormDescription>{startDateHint}</FormDescription>
                ) : null}
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-sm">{t("datesHelp")}</p>
    </div>
  );
}

export function AdsKeywordsSection({
  projectId,
  hasMarketProfile,
}: Pick<AdsGoogleSearchFieldsProps, "projectId" | "hasMarketProfile">) {
  const t = useTranslations("App.Ads.newCampaign.keywords");
  const form = useFormContext<GoogleSearchFormValues>();
  const { keywords } = parseGoogleKeywords(form.watch("keywords"));
  const over = keywords.length > GOOGLE_KEYWORD_LIMIT;

  function handleAdd(names: string[]): number {
    const { text, added } = appendBroadKeywords(
      form.getValues("keywords"),
      names,
    );
    if (added > 0) {
      form.setValue("keywords", text, {
        shouldDirty: true,
        shouldValidate:
          form.formState.isSubmitted || !!form.formState.touchedFields.keywords,
      });
    }
    return added;
  }

  return (
    <AdsSection id="campaign-form-keywords" title={t("label")}>
      <FormField
        control={form.control}
        name="keywords"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="sr-only">{t("label")}</FormLabel>
            <FormDescription>{t("help")}</FormDescription>
            <FormControl>
              <Textarea
                autoCapitalize="off"
                className="min-h-40"
                placeholder={t("placeholder")}
                rows={8}
                spellCheck={false}
                {...field}
              />
            </FormControl>
            <div className="flex min-h-8 items-center justify-between gap-3">
              <p
                aria-live="polite"
                className={cn(
                  "text-sm",
                  over ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {t("count", { count: keywords.length })}
              </p>
              {hasMarketProfile ? (
                <AdsAddMarketKeywords onAdd={handleAdd} projectId={projectId} />
              ) : null}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </AdsSection>
  );
}

export function AdsSearchAdSection() {
  const t = useTranslations("App.Ads.newCampaign.ad");
  const tSection = useTranslations("App.Ads.newCampaign.sections");
  const form = useFormContext<GoogleSearchFormValues>();
  const [finalUrl, path1, path2] = form.watch(["finalUrl", "path1", "path2"]);

  return (
    <AdsSection id="campaign-form-ad" title={tSection("ad")}>
      <AdsFinalUrlField />
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("displayPath")}</legend>
        <p className="text-muted-foreground text-sm">{t("displayPathHelp")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["path1", "path2"] as const).map((name) => (
            <FormField
              control={form.control}
              key={name}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground font-normal">
                    {t(name)}
                  </FormLabel>
                  <FormControl>
                    <Input autoComplete="off" spellCheck={false} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
        <p className="text-muted-foreground text-sm">
          {t("pathPreview", { url: adDisplayUrl(finalUrl, path1, path2) })}
        </p>
      </fieldset>
      <AdsTextList limits={GOOGLE_SEARCH_LIMITS.headlines} name="headlines" />
      <AdsTextList
        limits={GOOGLE_SEARCH_LIMITS.descriptions}
        name="descriptions"
      />
      <AdsSitelinksSection />
      <AdsCalloutsSection />
    </AdsSection>
  );
}
