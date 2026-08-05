"use client";

import type { SessionUser } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import { useTranslations } from "next-intl";
import UserAvatarContent from "@/app/components/user-avatar/user-avatar-content";
import { OrganizationLogo } from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";
import type { OrganizationRecord } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface HeaderWorkspaceAvatarProps {
  sessionUser: SessionUser;
  organization?: OrganizationRecord | null;
  className?: string;
  logoSize?: number;
  /**
   * When true, the avatar is purely visual (e.g. closed switcher trigger that
   * already exposes the workspace name in text). Hides the image from AT.
   */
  decorative?: boolean;
}

export default function HeaderWorkspaceAvatar({
  sessionUser,
  organization,
  className = "size-8",
  logoSize = 18,
  decorative = false,
}: HeaderWorkspaceAvatarProps) {
  const t = useTranslations("Components.OrganizationSwitcher");
  const avatar = organization ? (
    <Avatar className={cn("bg-muted items-center justify-center", className)}>
      <OrganizationLogo organization={organization} size={logoSize} />
    </Avatar>
  ) : (
    <UserAvatarContent
      className={className}
      imageUrl={
        sessionUser.image ??
        gravatarUrl(sessionUser.email, {
          size: 80,
          default: "404",
        })
      }
      imageAlt={decorative ? "" : (sessionUser.name ?? t("userAvatarAlt"))}
    />
  );

  if (decorative) {
    return <span aria-hidden="true">{avatar}</span>;
  }

  return avatar;
}
