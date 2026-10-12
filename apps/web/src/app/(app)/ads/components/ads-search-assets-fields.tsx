"use client";

import { ChevronRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  filledCallouts,
  filledSitelinks,
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchFormValues,
} from "@/lib/ads/google-search";

import { AdsCharCount, AdsTextList } from "./ads-text-list";

const SITELINKS = GOOGLE_SEARCH_LIMITS.sitelinks;
const EMPTY_SITELINK = {
  text: "",
  finalUrl: "",
  description1: "",
  description2: "",
};

interface OptionalSectionProps {
  title: string;
  /** Said next to the title once something is filled in. */
  summary: string | null;
  /** Opens the section regardless, so a refusal inside it is seen. */
  invalid: boolean;
  children: ReactNode;
}

/** An optional part of the ad: closed until the reader wants it. */
function OptionalSection({
  title,
  summary,
  invalid,
  children,
}: OptionalSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open || invalid} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group focus-visible:ring-ring-halo -m-1 flex items-center gap-2 rounded-md p-1 text-left text-sm font-medium outline-none focus-visible:ring-[3px]">
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0 group-data-[state=open]:rotate-90 motion-safe:transition-transform"
        />
        {title}
        {summary ? (
          <span className="text-muted-foreground font-normal">{summary}</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Up to eight extra links under the ad, each with its own text and address. */
export function AdsSitelinksSection() {
  const t = useTranslations("App.Ads.newCampaign.ad.sitelinks");
  const form = useFormContext<GoogleSearchFormValues>();
  const rows = form.watch("sitelinks");
  const addRef = useRef<HTMLButtonElement>(null);
  const count = filledSitelinks(rows).length;
  // Once the reader has submitted, a changed list is checked again at once.
  const revalidate = form.formState.isSubmitted;

  function handleAdd(): void {
    form.setValue("sitelinks", [...rows, EMPTY_SITELINK], {
      shouldDirty: true,
    });
    // The new input mounts after this render.
    requestAnimationFrame(() => form.setFocus(`sitelinks.${rows.length}.text`));
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
    <OptionalSection
      invalid={!!form.formState.errors.sitelinks}
      summary={count > 0 ? t("summary", { count }) : null}
      title={t("title")}
    >
      <div className="grid gap-6">
        <p className="text-muted-foreground text-sm">
          {t("help", { max: SITELINKS.max })}
        </p>
        {rows.map((row, index) => (
          <SitelinkRow
            index={index}
            key={index}
            onRemove={() => handleRemove(index)}
            row={row}
          />
        ))}
        {rows.length < SITELINKS.max ? (
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
    </OptionalSection>
  );
}

interface SitelinkRowProps {
  index: number;
  row: GoogleSearchFormValues["sitelinks"][number];
  onRemove: () => void;
}

const SITELINK_FIELDS = [
  { name: "text", max: SITELINKS.text },
  { name: "finalUrl" },
  { name: "description1", max: SITELINKS.description },
  { name: "description2", max: SITELINKS.description },
] as const;

/** One sitelink: link text, address and two optional description lines. */
function SitelinkRow({ index, row, onRemove }: SitelinkRowProps) {
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
        {SITELINK_FIELDS.map((item) => (
          <FormField
            control={form.control}
            key={item.name}
            name={`sitelinks.${index}.${item.name}`}
            render={({ field }) => (
              <FormItem>
                <div className="flex items-baseline justify-between gap-3">
                  <FormLabel className="text-muted-foreground font-normal">
                    {t(item.name)}
                  </FormLabel>
                  {"max" in item ? (
                    <AdsCharCount
                      length={row[item.name].length}
                      max={item.max}
                    />
                  ) : null}
                </div>
                <FormControl>
                  <Input
                    autoComplete="off"
                    {...(item.name === "finalUrl"
                      ? { autoCapitalize: "off", inputMode: "url" as const }
                      : {})}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Up to ten short highlights, such as "Free shipping". */
export function AdsCalloutsSection() {
  const t = useTranslations("App.Ads.newCampaign.ad.callouts");
  const form = useFormContext<GoogleSearchFormValues>();
  const count = filledCallouts(form.watch("callouts")).length;

  return (
    <OptionalSection
      invalid={!!form.formState.errors.callouts}
      summary={count > 0 ? t("summary", { count }) : null}
      title={t("title")}
    >
      <AdsTextList
        hideLegend
        limits={GOOGLE_SEARCH_LIMITS.callouts}
        name="callouts"
      />
    </OptionalSection>
  );
}
