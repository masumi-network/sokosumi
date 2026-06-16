"use client";

import type { Organization } from "@sokosumi/database";
import type { SessionUser } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import UserAvatarContent from "@/app/components/user-avatar/user-avatar-content";
import { OrganizationLogo } from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface HeaderWorkspaceAvatarProps {
  sessionUser: SessionUser;
  organization?: Organization | null;
  className?: string;
  logoSize?: number;
}

export default function HeaderWorkspaceAvatar({
  sessionUser,
  organization,
  className = "size-8 md:size-8",
  logoSize = 18,
}: HeaderWorkspaceAvatarProps) {
  if (organization) {
    return (
      <Avatar className={cn("bg-muted items-center justify-center", className)}>
        <OrganizationLogo organization={organization} size={logoSize} />
      </Avatar>
    );
  }

  return (
    <UserAvatarContent
      className={className}
      imageUrl={
        sessionUser.image ??
        gravatarUrl(sessionUser.email, {
          size: 80,
          default: "404",
        })
      }
      imageAlt={sessionUser.name ?? "User avatar"}
    />
  );
}
