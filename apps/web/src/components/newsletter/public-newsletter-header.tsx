import type { PublicNewsletter } from "@sokosumi/core-client";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NEWSLETTER_BUTTON_SHAPE } from "./design";

interface PublicNewsletterHeaderProps {
  newsletter: PublicNewsletter;
  slug: string;
  subscribeLabel?: string;
  compact?: boolean;
}

export function PublicNewsletterHeader({
  newsletter,
  slug,
  subscribeLabel,
  compact = false,
}: PublicNewsletterHeaderProps) {
  const Header = compact ? "div" : "header";
  const centered = newsletter.brand.headerAlign === "center";
  if (compact && !newsletter.brand.logoUrl && !newsletter.brand.headerImageUrl)
    return null;
  return (
    <Header
      className={cn(
        "min-w-0 space-y-4",
        !compact && "rounded-xl border-y-4 p-6",
      )}
      style={{
        borderTopColor: newsletter.brand.primaryColor,
        borderBottomColor: newsletter.brand.accentColor,
        color: newsletter.brand.primaryColor,
        fontFamily: newsletter.brand.fontFamily,
      }}
    >
      {newsletter.brand.headerImageUrl ? (
        <Image
          src={newsletter.brand.headerImageUrl}
          alt=""
          width={1200}
          height={400}
          unoptimized
          className="h-auto w-full rounded-sm"
        />
      ) : null}
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center justify-between gap-4",
          centered && "flex-col text-center",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-4",
            centered && "flex-col",
          )}
        >
          {newsletter.brand.logoUrl ? (
            <Image
              src={newsletter.brand.logoUrl}
              alt=""
              width={64}
              height={64}
              unoptimized
              className="size-16 shrink-0 object-contain"
            />
          ) : null}
          {!compact ? (
            <p className="text-lg font-semibold wrap-anywhere">
              {newsletter.name}
            </p>
          ) : null}
        </div>
        {subscribeLabel ? (
          <Button
            asChild
            variant="primary"
            className={
              NEWSLETTER_BUTTON_SHAPE[newsletter.brand.buttonShape ?? "rounded"]
            }
            style={{
              backgroundColor: newsletter.brand.accentColor,
              color: newsletter.brand.buttonTextColor,
            }}
          >
            <Link href={`/n/${encodeURIComponent(slug)}`}>
              {subscribeLabel}
            </Link>
          </Button>
        ) : null}
      </div>
    </Header>
  );
}
