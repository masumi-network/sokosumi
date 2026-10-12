"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormContext } from "react-hook-form";

import { Button } from "@/components/ui/button";
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
import type { GoogleTarget } from "@/lib/ads/targeting";
import { cn } from "@/lib/utils";

import { AdsAddMarketKeywords } from "./ads-add-market-keywords";
import { AdsFormSection } from "./ads-form-section";
import { AdsGoogleTargetingFields } from "./ads-targeting-fields";

interface AdsGoogleSearchFieldsProps {
  accountId: string;
  projectId: string;
  /** Google's languages; null when they could not be loaded. */
  languages: GoogleTarget[] | null;
  /** Whether "Add from Market" has keywords to draw on. */
  hasMarketProfile: boolean;
}

/**
 * The Search campaign's own sections, inside the create form: the targeting
 * line, keywords and the ad. They read and write the form around them.
 */
export function AdsGoogleSearchFields({
  accountId,
  languages,
  projectId,
  hasMarketProfile,
}: AdsGoogleSearchFieldsProps) {
  const t = useTranslations("App.Ads.newCampaign");

  return (
    <>
      <AdsFormSection
        id="new-campaign-targeting"
        title={t("sections.targeting")}
      >
        <AdsGoogleTargetingFields
          accountId={accountId}
          languages={languages}
          projectId={projectId}
        />
      </AdsFormSection>
      <KeywordsSection
        hasMarketProfile={hasMarketProfile}
        projectId={projectId}
      />
      <AdSection />
    </>
  );
}

/** The optional dates, which close the Basics section. */
export function AdsGoogleDateFields() {
  const t = useTranslations("App.Ads.newCampaign");
  const form = useFormContext<GoogleSearchFormValues>();

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
                  <Input type="date" {...field} />
                </FormControl>
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

function KeywordsSection({
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
    <AdsFormSection id="new-campaign-keywords" title={t("label")}>
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
    </AdsFormSection>
  );
}

function AdSection() {
  const t = useTranslations("App.Ads.newCampaign.ad");
  const tSection = useTranslations("App.Ads.newCampaign.sections");
  const form = useFormContext<GoogleSearchFormValues>();
  const [finalUrl, path1, path2] = form.watch(["finalUrl", "path1", "path2"]);

  return (
    <AdsFormSection id="new-campaign-ad" title={tSection("ad")}>
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
      <TextList limits={GOOGLE_SEARCH_LIMITS.headlines} name="headlines" />
      <TextList
        limits={GOOGLE_SEARCH_LIMITS.descriptions}
        name="descriptions"
      />
    </AdsFormSection>
  );
}

interface TextListProps {
  limits: { min: number; max: number; length: number };
  name: "headlines" | "descriptions";
}

/**
 * A list of single-line texts with a character counter on each: it starts
 * with the minimum Core needs, grows to the maximum and shrinks back to the
 * minimum.
 */
function TextList({ limits, name }: TextListProps) {
  const t = useTranslations(`App.Ads.newCampaign.ad.${name}`);
  const form = useFormContext<GoogleSearchFormValues>();
  const values = form.watch(name);
  // Once the reader has submitted, a changed list is checked again at once.
  const revalidate = form.formState.isSubmitted;

  function handleAdd(): void {
    form.setValue(name, [...values, ""], { shouldDirty: true });
    // The new input mounts after this render.
    requestAnimationFrame(() => form.setFocus(`${name}.${values.length}`));
  }

  function handleRemove(index: number): void {
    form.setValue(
      name,
      values.filter((_, position) => position !== index),
      { shouldDirty: true, shouldValidate: revalidate },
    );
    form.setFocus(`${name}.${Math.max(0, index - 1)}`);
  }

  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-medium">{t("label")}</legend>
      <p className="text-muted-foreground text-sm">
        {t("help", { ...limits })}
      </p>
      {values.map((value, index) => (
        // The row is its position: fields are bound by `name.index`.
        <FormField
          control={form.control}
          key={index}
          name={`${name}.${index}`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">
                {t("item", { number: index + 1 })}
              </FormLabel>
              <div className="flex items-center gap-2">
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <span
                  className={cn(
                    "w-12 shrink-0 text-right text-xs tabular-nums",
                    value.length > limits.length
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {value.length}/{limits.length}
                </span>
                {values.length > limits.min ? (
                  <Button
                    aria-label={t("remove", { number: index + 1 })}
                    onClick={() => handleRemove(index)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
      {values.length < limits.max ? (
        <Button
          className="self-start"
          onClick={handleAdd}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("add")}
        </Button>
      ) : null}
    </fieldset>
  );
}
