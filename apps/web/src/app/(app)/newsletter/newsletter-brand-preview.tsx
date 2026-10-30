"use client";

import { useTranslations } from "next-intl";
import { type Control, useWatch } from "react-hook-form";

import { Avatar, AvatarImage } from "@/components/ui/avatar";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import type { NewsletterSettingsValues } from "@/lib/schemas/newsletter";
import { cn } from "@/lib/utils";

const HEX = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

/** A color the schema would accept, or nothing so the preview keeps its default. */
function brandColor(value: string): string | undefined {
  const color = value.trim();
  return HEX.test(color) ? color : undefined;
}

/**
 * A live sketch of the settings as an issue shows them, following the email
 * renderer (`@sokosumi/email` newsletter): logo, primary-colored text, an
 * accent button, the footer, and the welcome email when it is on. Presentational only; it reads the form as it changes.
 */
export function NewsletterBrandPreview({
  control,
}: {
  control: Control<NewsletterSettingsValues>;
}) {
  const t = useTranslations("App.Projects.Newsletter.Preview");
  const [
    name,
    senderName,
    logoUrl,
    primaryColor,
    accentColor,
    fontFamily,
    footerText,
    welcomeEmailEnabled,
    welcomeSubject,
    welcomeBody,
  ] = useWatch({
    control,
    name: [
      "name",
      "senderName",
      "logoUrl",
      "primaryColor",
      "accentColor",
      "fontFamily",
      "footerText",
      "welcomeEmailEnabled",
      "welcomeSubject",
      "welcomeBody",
    ],
  });
  const primary = brandColor(primaryColor);
  const accent = brandColor(accentColor);
  const logo = logoUrl.trim();

  return (
    <section
      aria-labelledby="newsletter-preview"
      className={cn(HOLDER_CLASS, "min-w-0 space-y-3 p-3")}
    >
      <div className="space-y-0.5 px-1 pt-1">
        <h3
          id="newsletter-preview"
          className="text-muted-foreground text-xs font-medium"
        >
          {t("title")}
        </h3>
        <p className="text-muted-foreground text-xs text-pretty">
          {t("description")}
        </p>
      </div>

      <div
        className={cn(HOLDER_ITEM_CLASS, "min-w-0 overflow-hidden")}
        style={{ fontFamily }}
      >
        {/* The renderer sets the primary color on all text, as here. */}
        <div
          className="min-w-0 space-y-4 p-5"
          style={primary ? { color: primary } : undefined}
        >
          {logo ? (
            <Avatar className="size-12 rounded-none">
              <AvatarImage src={logo} alt="" className="object-contain" />
            </Avatar>
          ) : null}
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold break-words">{name}</p>
            <p className="text-muted-foreground text-xs break-words">
              {t("from", { sender: senderName })}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-base font-semibold">{t("sampleHeading")}</p>
            <p className="text-sm">{t("sampleBody")}</p>
          </div>
          <span
            className="bg-primary text-primary-foreground inline-flex rounded px-4 py-2 text-sm font-medium"
            style={accent ? { backgroundColor: accent } : undefined}
          >
            {t("button")}
          </span>
          <div className="text-muted-foreground space-y-1 border-t pt-4 text-xs">
            <p className="break-words">{name}</p>
            {footerText.trim() ? (
              <p className="break-words whitespace-pre-line">{footerText}</p>
            ) : null}
            <p className="underline underline-offset-2">{t("unsubscribe")}</p>
          </div>
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs">
        {(
          [
            ["primary", primary, "bg-foreground"],
            ["accent", accent, "bg-primary"],
          ] as const
        ).map(([key, color, fallback]) => (
          <div key={key} className="flex min-w-0 items-center gap-1.5">
            <dt className="text-muted-foreground">{t(key)}</dt>
            <dd className="flex items-center gap-1.5 font-mono">
              <span
                aria-hidden
                className={cn("size-3 rounded-full border", fallback)}
                style={color ? { backgroundColor: color } : undefined}
              />
              {color ?? t("unset")}
            </dd>
          </div>
        ))}
      </dl>

      {welcomeEmailEnabled ? (
        <div className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-2 p-4")}>
          <p className="text-muted-foreground text-xs font-medium">
            {t("welcome")}
          </p>
          <p className="text-sm font-semibold break-words">
            {welcomeSubject.trim() || t("noSubject")}
          </p>
          {welcomeBody.trim() ? (
            <p
              className="text-muted-foreground line-clamp-6 text-sm break-words whitespace-pre-line"
              style={{ fontFamily }}
            >
              {welcomeBody}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
