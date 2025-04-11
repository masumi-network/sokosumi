"use client";

import { CreditCardIcon, LogOut, User as UserIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { User } from "@/lib/auth/auth";
import { signOut } from "@/lib/auth/auth.client";

import UserAvatarContent from "./user-avatar-content";

interface UserAvatarClientProps {
  user: User;
}

export default function UserAvatarClient({ user }: UserAvatarClientProps) {
  const router = useRouter();
  const t = useTranslations("Components.UserAvatar");

  const onSignOut = async () => {
    await signOut({
      fetchOptions: {
        onError: () => {
          toast.error(t("Error.signOut"));
        },
        onSuccess: () => {
          router.push("/signin");
        },
      },
    });
  };

  return (
    <DropdownMenu>
      <TooltipProvider disableHoverableContent>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="relative h-8 w-8 rounded-full"
                aria-label={`User profile for ${user.name ?? "current user"}`}
              >
                <UserAvatarContent
                  imageUrl={user.image ?? ""}
                  imageAlt={user.name ?? "User avatar"}
                />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{user.name}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm leading-none font-medium">{user.name}</p>
            <p className="text-muted-foreground text-xs leading-none">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className="hover:cursor-pointer" asChild>
            <Link href="/app/account" className="flex items-center gap-2">
              <UserIcon className="text-muted-foreground" />
              {t("account")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="hover:cursor-pointer" asChild>
            <Link href="/app/billing" className="flex items-center gap-2">
              <CreditCardIcon className="text-muted-foreground" />
              {t("billing")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="flex items-center gap-2 hover:cursor-pointer"
          onClick={onSignOut}
        >
          <LogOut className="text-muted-foreground" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
