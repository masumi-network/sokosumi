"use client";

import type { ProjectSocialConnection } from "@sokosumi/core-client";
import { useState } from "react";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function AccountChipLogo({
  className,
  provider,
}: {
  className: string;
  provider: ProjectSocialConnection["provider"];
}) {
  return (
    <SocialPostProviderIcon
      aria-hidden
      className={className}
      data-testid="social-post-account-logo"
      provider={provider}
    />
  );
}

/** Photo with a corner network badge, or the same logo circle main uses. */
export function AccountChipMark({
  avatarUrl,
  provider,
}: {
  avatarUrl: string | null;
  provider: ProjectSocialConnection["provider"];
}) {
  const [photoReady, setPhotoReady] = useState(false);
  const showPhoto = Boolean(avatarUrl) && photoReady;

  if (!avatarUrl) {
    return (
      <span
        aria-hidden
        className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full"
      >
        <AccountChipLogo className="size-3.5" provider={provider} />
      </span>
    );
  }

  return (
    <span aria-hidden className="relative size-6 shrink-0">
      <Avatar className={cn("size-6", !showPhoto && "invisible")}>
        <AvatarImage
          alt=""
          data-testid="social-post-account-photo"
          onLoadingStatusChange={(status) => {
            setPhotoReady(status === "loaded");
          }}
          src={avatarUrl}
        />
      </Avatar>
      {showPhoto ? (
        <span
          className="bg-background ring-background absolute end-0 bottom-0 flex size-3 items-center justify-center rounded-full ring-1"
          data-testid="social-post-account-logo-badge"
        >
          <AccountChipLogo className="size-2" provider={provider} />
        </span>
      ) : (
        <span className="bg-muted absolute inset-0 flex items-center justify-center rounded-full">
          <AccountChipLogo className="size-3.5" provider={provider} />
        </span>
      )}
    </span>
  );
}
