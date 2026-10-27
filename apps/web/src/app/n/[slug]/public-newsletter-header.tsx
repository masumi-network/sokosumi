import type { PublicNewsletter } from "@sokosumi/core-client";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface PublicNewsletterHeaderProps {
  newsletter: PublicNewsletter;
  slug: string;
  subscribeLabel: string;
}

export function PublicNewsletterHeader({
  newsletter,
  slug,
  subscribeLabel,
}: PublicNewsletterHeaderProps) {
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-y-4 p-6"
      style={{
        borderTopColor: newsletter.brand.primaryColor,
        borderBottomColor: newsletter.brand.accentColor,
      }}
    >
      <div className="flex min-w-0 items-center gap-4">
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
        <p className="text-lg font-semibold wrap-anywhere">{newsletter.name}</p>
      </div>
      <Button asChild variant="primary">
        <Link href={`/n/${encodeURIComponent(slug)}`}>{subscribeLabel}</Link>
      </Button>
    </header>
  );
}
