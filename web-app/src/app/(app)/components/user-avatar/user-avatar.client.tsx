"use client";

import gravatarUrl from "gravatar-url";
import {
  Building2,
  CircleHelp,
  CreditCardIcon,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
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
import { useSidebar } from "@/components/ui/sidebar";
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

  const router = useRouter();
  const { isMobile, toggleSidebar } = useSidebar();

  const handleClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();

    if (!path) {
      return;
    }

    router.push(path);
    // Close sidebar if on mobile
    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <DropdownMenu>
      <TooltipProvider disableHoverableContent>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="relative h-8 w-8 rounded-full px-2 md:h-10 md:w-10 md:px-4"
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

      <DropdownMenuContent className="w-60" align="end">
        <OrganizationSwitcher
          members={members}
          activeOrganizationId={activeOrganizationId}
          sessionUserName={sessionUser.name}
        />
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2"
            onClick={(e) => handleClick(e, "/account")}
          >
            <UserIcon className="text-muted-foreground" />
            {t("account")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2"
            onClick={(e) => handleClick(e, "/organizations")}
          >
            <Building2 className="text-muted-foreground" />
            {t("organizations")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2"
            onClick={(e) => handleClick(e, "/billing")}
          >
            <CreditCardIcon className="text-muted-foreground" />
            {t("billing")}
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
