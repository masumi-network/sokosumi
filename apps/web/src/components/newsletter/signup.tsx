"use client";

import type { PublicNewsletter } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PublicNewsletterHeader } from "./public-newsletter-header";
import { NewsletterSignupForm } from "./signup-form";

const PADDING = { compact: "p-5", normal: "p-8", roomy: "p-11" } as const;

interface NewsletterSignupProps {
  newsletter: PublicNewsletter;
  slug: string;
  embed?: boolean;
  preview?: boolean;
}

/** The hosted page, embed and live designer all render the same signup. */
export function NewsletterSignup({
  newsletter,
  slug,
  embed = false,
  preview = false,
}: NewsletterSignupProps) {
  const t = useTranslations("PublicNewsletter.Signup");
  const headingId = useId();
  const shared = newsletter.brand;
  const overrides = shared.signupForm;
  const brand = {
    ...shared,
    accentColor: overrides?.accentColor ?? shared.accentColor,
    buttonTextColor: overrides?.buttonTextColor ?? shared.buttonTextColor,
    buttonShape: overrides?.buttonShape ?? shared.buttonShape,
    headerAlign: overrides?.headerAlign ?? shared.headerAlign,
    spacing: overrides?.spacing ?? shared.spacing,
  };
  const Heading = preview ? "h4" : "h1";

  return (
    <section
      data-newsletter-embed={embed ? "" : undefined}
      data-newsletter-signup=""
      aria-labelledby={headingId}
      className="bg-background min-w-0 rounded-xl p-3"
      style={{
        backgroundColor: brand.backgroundColor,
        fontFamily: brand.fontFamily,
      }}
    >
      <div
        className={cn(
          "bg-card text-card-foreground min-w-0 space-y-6 rounded-lg border",
          PADDING[brand.spacing ?? "normal"],
        )}
        style={{ color: brand.primaryColor }}
      >
        <PublicNewsletterHeader
          newsletter={{ ...newsletter, brand }}
          slug={slug}
          compact={embed}
        />
        <div className="mx-auto max-w-md space-y-6">
          <div
            className={cn(
              "space-y-2",
              brand.headerAlign === "center" && "text-center",
            )}
          >
            <Heading
              id={headingId}
              className="text-2xl font-semibold tracking-tight wrap-anywhere"
            >
              {embed ? newsletter.name : t("title", { name: newsletter.name })}
            </Heading>
            {!embed ? (
              <p className="text-sm leading-relaxed">{t("description")}</p>
            ) : null}
          </div>
          <NewsletterSignupForm
            key={slug}
            slug={slug}
            brand={brand}
            preview={preview}
          />
          {!embed && !preview ? (
            <Button asChild variant="link" className="px-0 text-inherit">
              <Link href={`/n/${encodeURIComponent(slug)}/archive`}>
                {t("archive")}
              </Link>
            </Button>
          ) : null}
          {brand.footerText ? (
            <p className="text-sm wrap-anywhere whitespace-pre-line">
              {brand.footerText}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
