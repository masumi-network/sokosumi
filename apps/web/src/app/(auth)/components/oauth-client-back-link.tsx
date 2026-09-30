import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";

/**
 * The row above the sign-in and sign-up title for a person sent here through
 * Sign in with Sokosumi: the product's logo, inside a way back to it when its
 * client row names a home page.
 */
interface OAuthClientBackLinkProps {
  client: OAuthRequestClient;
}

export default function OAuthClientBackLink({
  client,
}: OAuthClientBackLinkProps) {
  const t = useTranslations("Auth.OAuthClient");
  // Unoptimized: a client row may name any host, which the image optimizer
  // only fetches from an allowlist. The link text names the product, so the
  // logo is decorative.
  const logo = client.logoUri ? (
    <Image
      src={client.logoUri}
      alt=""
      width={20}
      height={20}
      unoptimized
      className="size-5 shrink-0 rounded-sm object-contain"
    />
  ) : null;

  if (!client.uri) {
    return logo ? <div className="mb-4 flex">{logo}</div> : null;
  }
  return (
    <Link
      href={client.uri}
      className="mb-4 inline-flex max-w-full items-center gap-2 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-4 shrink-0" />
      {logo}
      <span className="min-w-0 wrap-anywhere">
        {t("backTo", { client: client.name })}
      </span>
    </Link>
  );
}
