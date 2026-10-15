"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useId, useRef } from "react";
import { flushSync } from "react-dom";
import { useFormContext } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  EMPTY_SITELINK,
  filledCallouts,
  filledSitelinks,
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchFormValues,
  SITELINK_LIMITS,
  type SitelinkFormValues,
} from "@/lib/ads/google-search";

import { AdsOptionalSection } from "./ads-optional-section";
import { AdsCharCount, AdsCountedInput, AdsTextList } from "./ads-text-list";

/** Extra links under the ad, up to the schema's limit, each with its own text and address. */
export function AdsSitelinksSection() {
  const t = useTranslations("App.Ads.newCampaign.ad.sitelinks");
  const form = useFormContext<GoogleSearchFormValues>();
  const rows = form.watch("sitelinks");
  const addRef = useRef<HTMLButtonElement>(null);
  const count = filledSitelinks(rows).length;
  // Once the reader has submitted, a changed list is checked again at once.
  const revalidate = form.formState.isSubmitted;

  function handleAdd(): void {
    // Mount the new row now, so focus leaves the button before the next key.
    flushSync(() =>
      form.setValue("sitelinks", [...rows, EMPTY_SITELINK], {
        shouldDirty: true,
      }),
    );
    form.setFocus(`sitelinks.${rows.length}.text`);
  }

  function handleRemove(index: number): void {
    form.setValue(
      "sitelinks",
      rows.filter((_, position) => position !== index),
      { shouldDirty: true, shouldValidate: revalidate },
    );
    if (rows.length > 1) {
      form.setFocus(`sitelinks.${Math.max(0, index - 1)}.text`);
    } else {
      addRef.current?.focus();
    }
  }

  return (
    <AdsOptionalSection
      invalid={!!form.formState.errors.sitelinks}
      summary={count > 0 ? t("summary", { count }) : null}
      title={t("title")}
    >
      <div className="grid gap-6">
        <p className="text-muted-foreground text-sm">
          {t("help", { max: SITELINK_LIMITS.max })}
        </p>
        {rows.map((_, index) => (
          <SitelinkRow
            index={index}
            key={index}
            onRemove={() => handleRemove(index)}
          />
        ))}
        {rows.length < SITELINK_LIMITS.max ? (
          <Button
            className="self-start"
            onClick={handleAdd}
            ref={addRef}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("add")}
          </Button>
        ) : null}
      </div>
    </AdsOptionalSection>
  );
}

interface SitelinkRowProps {
  index: number;
  onRemove: () => void;
}

interface SitelinkFieldSpec {
  name: keyof SitelinkFormValues;
  /** Fields with a limit worth watching show a counter. */
  max?: number;
  input?: ComponentProps<"input">;
}

const SITELINK_FIELDS: readonly SitelinkFieldSpec[] = [
  { name: "text", max: SITELINK_LIMITS.text },
  { name: "finalUrl", input: { autoCapitalize: "off", inputMode: "url" } },
  { name: "description1", max: SITELINK_LIMITS.description },
  { name: "description2", max: SITELINK_LIMITS.description },
];

/** One sitelink: link text, address and two optional description lines. */
function SitelinkRow({ index, onRemove }: SitelinkRowProps) {
  const t = useTranslations("App.Ads.newCampaign.ad.sitelinks");
  const form = useFormContext<GoogleSearchFormValues>();
  const titleId = useId();

  return (
    <div aria-labelledby={titleId} className="grid gap-3" role="group">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium" id={titleId}>
          {t("item", { number: index + 1 })}
        </p>
        <Button
          aria-label={t("remove", { number: index + 1 })}
          onClick={onRemove}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SITELINK_FIELDS.map(({ name, max, input }) => {
          const counter =
            max === undefined ? undefined : { id: `${titleId}-${name}`, max };

          return (
            <FormField
              control={form.control}
              key={name}
              name={`sitelinks.${index}.${name}`}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-baseline justify-between gap-3">
                    <FormLabel className="text-muted-foreground font-normal">
                      {t(name)}
                    </FormLabel>
                    {counter ? (
                      <AdsCharCount
                        id={counter.id}
                        max={counter.max}
                        text={field.value}
                      />
                    ) : null}
                  </div>
                  <FormControl>
                    <AdsCountedInput
                      autoComplete="off"
                      counterId={counter?.id}
                      {...input}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Short highlights, up to the schema's limit, such as "Free shipping". */
export function AdsCalloutsSection() {
  const t = useTranslations("App.Ads.newCampaign.ad.callouts");
  const form = useFormContext<GoogleSearchFormValues>();
  const count = filledCallouts(form.watch("callouts")).length;

  return (
    <AdsOptionalSection
      invalid={!!form.formState.errors.callouts}
      summary={count > 0 ? t("summary", { count }) : null}
      title={t("title")}
    >
      <AdsTextList
        hideLegend
        limits={GOOGLE_SEARCH_LIMITS.callouts}
        name="callouts"
      />
    </AdsOptionalSection>
  );
}
