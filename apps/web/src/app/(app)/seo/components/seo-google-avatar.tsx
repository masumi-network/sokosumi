"use client";

import { GoogleIcon } from "@/components/social-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { SeoGoogleAccount } from "./use-seo-connection";

/** The Google mark sits on the photo's corner, so the reader sees which service the account is from. */
const GOOGLE_BADGE_SIZE = 14;
const GOOGLE_MARK_SIZE = 20;

/**
 * The photo of a Google account with the Google mark on it. Without a photo,
 * or before one loads, the Google mark alone stands in its place.
 */
export function SeoGoogleAvatar({
  account,
}: {
  account: SeoGoogleAccount | null;
}) {
  return (
    <span className="relative shrink-0">
      <Avatar className="bg-secondary size-9 border">
        {account?.pictureUrl ? (
          <AvatarImage
            src={account.pictureUrl}
            // Google serves account photos without a referrer, and the audit URL stays private.
            referrerPolicy="no-referrer"
            alt=""
          />
        ) : null}
        <AvatarFallback className="flex size-full items-center justify-center">
          <GoogleIcon size={GOOGLE_MARK_SIZE} />
        </AvatarFallback>
      </Avatar>
      {account?.pictureUrl ? (
        <span
          aria-hidden
          className="bg-background absolute -right-1 -bottom-1 flex items-center justify-center rounded-full border p-0.5"
        >
          <GoogleIcon size={GOOGLE_BADGE_SIZE} />
        </span>
      ) : null}
    </span>
  );
}
