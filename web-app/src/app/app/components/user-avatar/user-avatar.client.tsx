"use client";

import gravatarUrl from "gravatar-url";
import {
  Building2,
  CircleHelp,
  CreditCardIcon,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SessionUser } from "@/lib/auth/auth";
import { MemberWithOrganization } from "@/lib/db";

import { OrganizationSwitcher } from "./organization-switcher";
import UserAvatarContent from "./user-avatar-content";

interface UserAvatarClientProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
}

export default function UserAvatarClient({
  sessionUser,
  members,
  activeOrganizationId,
}: UserAvatarClientProps) {
  const t = useTranslations("Components.UserAvatar");

  const { showLogoutModal } = useGlobalModalsContext();
  const handleSupport = () => {
    window.open("https://www.masumi.network/contact", "_blank");
  };

  return (
    <DropdownMenu>
      <TooltipProvider disableHoverableContent>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="relative h-10 w-10 rounded-full"
                aria-label={`User profile for ${sessionUser.name ?? "current user"}`}
              >
                <UserAvatarContent
                  imageUrl={gravatarUrl(sessionUser.email, {
                    size: 80,
                    default: "404",
                  })}
                  imageAlt={sessionUser.name ?? "User avatar"}
                />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{sessionUser.email}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenuContent className="w-60" align="end" forceMount>
        <OrganizationSwitcher
          members={members}
          activeOrganizationId={activeOrganizationId}
          sessionUserName={sessionUser.name}
        />
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className="cursor-pointer" asChild>
            <Link href="/app/account" className="flex items-center gap-2">
              <UserIcon className="text-muted-foreground" />
              {t("account")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" asChild>
            <Link href="/app/organizations" className="flex items-center gap-2">
              <Building2 className="text-muted-foreground" />
              {t("organizations")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" asChild>
            <Link href="/app/billing" className="flex items-center gap-2">
              <CreditCardIcon className="text-muted-foreground" />
              {t("billing")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="flex cursor-pointer items-center gap-2"
          onClick={handleSupport}
        >
          <CircleHelp className="text-muted-foreground" />
          {t("support")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="flex cursor-pointer items-center gap-2"
          onClick={() => showLogoutModal(sessionUser.email)}
        >
          <LogOut className="text-muted-foreground" />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
