"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFormContext } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { displayAdPreview, searchAdPreview } from "@/lib/ads/ad-preview";
import { isKeptImage } from "@/lib/ads/google-display-images";
import type { GoogleFormValues } from "@/lib/ads/google-form-values";
import { cn } from "@/lib/utils";

export function AdsAdPreview() {
  const t = useTranslations("App.Ads.newCampaign.preview");
  const form = useFormContext<GoogleFormValues>();
  const values = form.watch();
  const [variant, setVariant] = useState(0);

  const search = values.type === "SEARCH";
  const variants = search
    ? searchAdPreview(values, variant).variants
    : displayAdPreview(toDisplayValues(values), variant).variants;

  return (
    <div className="flex flex-col gap-4">
      {search ? (
        <SearchPreview values={values} variant={variant} />
      ) : (
        <DisplayPreview values={values} variant={variant} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-md text-xs text-pretty">
          {t("note")}
        </p>
        {variants > 1 ? (
          <Button
            onClick={() => setVariant((current) => (current + 1) % variants)}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("another")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SearchPreview({
  values,
  variant,
}: {
  values: GoogleFormValues;
  variant: number;
}) {
  const t = useTranslations("App.Ads.newCampaign.preview");
  const ad = searchAdPreview(values, variant);

  return (
    <figure
      aria-label={t("searchLabel")}
      className="bg-background flex flex-col gap-1 rounded-xl border p-5 sm:p-6"
    >
      <p className="text-foreground text-xs font-semibold">{t("sponsored")}</p>
      <div className="mt-1 flex min-w-0 items-center gap-3">
        <Initial text={ad.domain} />
        <div className="min-w-0">
          <p className="truncate text-sm">{ad.domain}</p>
          <p className="text-muted-foreground truncate text-xs">
            {ad.displayUrl}
          </p>
        </div>
      </div>
      <p className="text-primary mt-2 text-lg leading-snug text-pretty">
        {ad.headline}
      </p>
      <p className="text-muted-foreground text-sm text-pretty">
        {ad.description}
      </p>
      {ad.callouts.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {ad.callouts.join(" · ")}
        </p>
      ) : null}
      {ad.sitelinks.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {ad.sitelinks.map((text, index) => (
            <li key={`${index}:${text}`} className="text-primary text-sm">
              {text}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

function toDisplayValues(values: GoogleFormValues) {
  return {
    ...values,
    images: values.images.map((image) => ({
      role: image.role,
      url: isKeptImage(image) ? image.url : image.fileUrl,
    })),
  };
}

function DisplayPreview({
  values,
  variant,
}: {
  values: GoogleFormValues;
  variant: number;
}) {
  const t = useTranslations("App.Ads.newCampaign.preview");
  const tRoles = useTranslations("App.Ads.newCampaign.ad.images.roles");
  const ad = displayAdPreview(toDisplayValues(values), variant);

  return (
    <figure
      aria-label={t("displayLabel")}
      className="grid items-start gap-4 sm:grid-cols-[3fr_2fr]"
    >
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">{tRoles("LANDSCAPE")}</p>
        <div className="bg-background overflow-hidden rounded-xl border">
          <Picture className="aspect-[1.91/1]" src={ad.landscape} />
          <div className="flex items-center gap-3 p-4">
            <Logo name={ad.businessName} src={ad.logo} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-pretty">
                {ad.longHeadline}
              </p>
              <p className="text-muted-foreground text-xs text-pretty">
                {ad.description}
              </p>
            </div>
            <span
              aria-hidden
              className="text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full border"
            >
              <ChevronRight className="size-4" />
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">{tRoles("SQUARE")}</p>
        <div className="bg-background overflow-hidden rounded-xl border">
          <Picture className="aspect-square" src={ad.square} />
          <div className="flex flex-col gap-1 p-4">
            <p className="text-sm font-medium text-pretty">{ad.headline}</p>
            <p className="text-muted-foreground text-xs text-pretty">
              {ad.description}
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted-foreground truncate text-xs">
                {ad.businessName || ad.domain}
              </span>
              <span className="text-primary text-sm font-medium">
                {t("open")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

function Picture({
  className,
  src,
}: {
  className: string;
  src: string | null;
}) {
  const t = useTranslations("App.Ads.newCampaign.preview");

  return (
    <div
      className={cn(
        "bg-muted flex items-center justify-center overflow-hidden",
        className,
      )}
    >
      {src ? (
        // A Drive or Google URL, so a plain `<img>` that sends no referrer.
        <img
          alt=""
          className="size-full object-cover"
          decoding="async"
          referrerPolicy="no-referrer"
          src={src}
        />
      ) : (
        <span className="text-muted-foreground text-xs">{t("noImage")}</span>
      )}
    </div>
  );
}

function Logo({ name, src }: { name: string; src: string | null }) {
  if (!src) return <Initial text={name} />;
  return (
    <img
      alt=""
      className="size-9 shrink-0 rounded-full object-cover"
      decoding="async"
      referrerPolicy="no-referrer"
      src={src}
    />
  );
}

function Initial({ text }: { text: string }) {
  return (
    <span
      aria-hidden
      className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium uppercase"
    >
      {text.charAt(0)}
    </span>
  );
}
