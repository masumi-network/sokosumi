"use client";

import { LayoutGrid, LogOut, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { authClient, signOut } from "@/lib/auth.client";
import { getInitials } from "@/lib/extensions/user";

function UserAvatarSkeleton() {
  return (
    <Button variant="outline" className="relative h-8 w-8 rounded-full">
      <Avatar className="h-8 w-8">
        <AvatarFallback className="bg-muted animate-pulse" />
      </Avatar>
    </Button>
  );
}

export default function UserAvatar() {
  const { data: session, isPending } = authClient.useSession();

  const router = useRouter();
  const t = useTranslations("Components.UserAvatar");

  const onSignOut = async () => {
    await signOut({
      fetchOptions: {
        onResponse: () => {
          router.push("/signin"); // redirect to login page
        },
      },
    });
  };

  if (isPending) {
    return <UserAvatarSkeleton />;
  }

  const user = session?.user;
  if (!user) {
    return <UserAvatarSkeleton />;
  }

  return (
    <DropdownMenu>
      <TooltipProvider disableHoverableContent>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="relative h-8 w-8 rounded-full"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.image || ""} alt={user.name || ""} />
                  <AvatarFallback>{getInitials(user)}</AvatarFallback>
                </Avatar>
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
            <Link href="/dashboard" className="flex items-center gap-2">
              <LayoutGrid className="text-muted-foreground" />
              {t("dashboard")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="hover:cursor-pointer" asChild>
            <Link href="/account" className="flex items-center gap-2">
              <User className="text-muted-foreground" />
              {t("account")}
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
