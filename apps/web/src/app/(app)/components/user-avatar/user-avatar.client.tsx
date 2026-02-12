"use client";

import { MemberWithOrganization } from "@sokosumi/database";
import gravatarUrl from "gravatar-url";
import {
  Building2,
  Cable,
  Check,
  ChevronDown,
  ChevronsUpDown,
  CircleHelp,
  CreditCardIcon,
  LogOut,
  Tag,
  User as UserIcon,
  WalletCards,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { OrganizationLogo } from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SessionUser } from "@/lib/auth/auth";
import { cn } from "@/lib/utils";

import UserAvatarContent from "./user-avatar-content";
import { useWorkspaceSwitcher } from "./workspace-switcher";

interface UserAvatarClientProps {
  creditsLabel?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  workspacePlanLabels: Record<string, string>;
}

interface WorkspaceItem {
  id: string | null;
  name: string;
  organization?: MemberWithOrganization["organization"];
}

interface WorkspaceRowProps {
  sessionUser: SessionUser;
  subtitle?: string;
  workspace: WorkspaceItem;
}

function getWorkspaceKey(workspace: WorkspaceItem): string {
  return workspace.id ?? "personal-account";
}

function getOrderedWorkspaces(
  workspaces: WorkspaceItem[],
  activeOrganizationId: string | null,
): WorkspaceItem[] {
  const activeIndex = workspaces.findIndex(
    (workspace) => workspace.id === activeOrganizationId,
  );

  if (activeIndex <= 0) {
    return workspaces;
  }

  return [
    workspaces[activeIndex],
    ...workspaces.slice(0, activeIndex),
    ...workspaces.slice(activeIndex + 1),
  ];
}

function WorkspaceRow({ sessionUser, subtitle, workspace }: WorkspaceRowProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {workspace.organization ? (
        <Avatar className="bg-muted size-8 items-center justify-center md:size-10">
          <OrganizationLogo organization={workspace.organization} size={36} />
        </Avatar>
      ) : (
        <UserAvatarContent
          imageUrl={
            sessionUser.image ??
            gravatarUrl(sessionUser.email, {
              size: 36,
              default: "404",
            })
          }
          imageAlt={sessionUser.name ?? "User avatar"}
        />
      )}
      <div className="flex min-w-0 flex-col items-start">
        <div className="text-sm font-semibold">
          <span className="truncate">{workspace.name}</span>
        </div>
        {subtitle ? (
          <div className="text-muted-foreground truncate text-xs">
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function UserAvatarClient({
  creditsLabel,
  primaryLabel,
  secondaryLabel,
  sessionUser,
  members,
  activeOrganizationId,
  workspacePlanLabels,
}: UserAvatarClientProps) {
  const t = useTranslations("Components.UserAvatar");
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();

  const { showLogoutModal } = useGlobalModalsContext();
  const handleSupport = () => {
    window.open("https://www.masumi.network/contact", "_blank");
  };

  const router = useRouter();
  const { isMobile, toggleSidebar } = useSidebar();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isWorkspacePopoverOpen, setIsWorkspacePopoverOpen] = useState(false);
  const workspaces = getOrderedWorkspaces(
    [
      {
        id: null,
        name: sessionUser.name ?? tOrganizationSwitcher("personalAccount"),
      },
      ...members.map((member) => ({
        id: member.organization.id,
        name: member.organization.name,
        organization: member.organization,
      })),
    ],
    activeOrganizationId,
  );
  const directWorkspaces = workspaces.slice(0, 4);
  const overflowWorkspaces = workspaces.slice(4);

  const handleSelectWorkspaceAndClose = (organizationId: string | null) => {
    setIsWorkspacePopoverOpen(false);
    setIsMenuOpen(false);
    handleSelectWorkspace(organizationId);
  };

  const handleClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();

    if (!path) {
      return;
    }

    setIsWorkspacePopoverOpen(false);
    setIsMenuOpen(false);
    router.push(path);
    // Close sidebar if on mobile
    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <TooltipProvider disableHoverableContent>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="min-h-11 min-w-40 justify-between px-1 py-1 hover:bg-transparent focus-visible:bg-transparent"
                  aria-label={`User profile for ${sessionUser.name ?? "current user"}`}
                >
                  <div className="flex w-full items-center justify-between gap-2 md:justify-center">
                    <div className="flex shrink-0">
                      <UserAvatarContent
                        imageUrl={
                          sessionUser.image ??
                          gravatarUrl(sessionUser.email, {
                            size: 80,
                            default: "404",
                          })
                        }
                        imageAlt={sessionUser.name ?? "User avatar"}
                      />
                    </div>
                    {primaryLabel || secondaryLabel ? (
                      <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                        {primaryLabel ? (
                          <span className="text-sm leading-none font-semibold">
                            {primaryLabel}
                          </span>
                        ) : null}
                        {secondaryLabel ? (
                          <span className="text-muted-foreground text-xs leading-none">
                            {secondaryLabel}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <ChevronDown className="text-muted-foreground size-4" />
                  </div>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{sessionUser.email}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <DropdownMenuContent className="w-72" align="end">
          <DropdownMenuGroup>
            {directWorkspaces.map((workspace) => (
              <DropdownMenuItem
                key={getWorkspaceKey(workspace)}
                className="flex cursor-pointer items-center justify-between gap-2 py-2"
                disabled={isPending}
                onSelect={(event) => {
                  event.preventDefault();
                  handleSelectWorkspaceAndClose(workspace.id);
                }}
              >
                <WorkspaceRow
                  sessionUser={sessionUser}
                  workspace={workspace}
                  subtitle={
                    workspace.id === activeOrganizationId
                      ? creditsLabel
                      : workspacePlanLabels[getWorkspaceKey(workspace)]
                  }
                />
                <Check
                  className={cn(
                    "size-4",
                    workspace.id === activeOrganizationId
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
              </DropdownMenuItem>
            ))}
            {overflowWorkspaces.length > 0 ? (
              isMobile ? (
                <Popover
                  open={isWorkspacePopoverOpen}
                  onOpenChange={setIsWorkspacePopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      role="combobox"
                      aria-expanded={isWorkspacePopoverOpen}
                      aria-label={tOrganizationSwitcher("switchWorkspace")}
                      disabled={isPending}
                      className={cn(
                        "w-full justify-between px-2 py-1.5",
                        isPending && "opacity-50",
                      )}
                      onClick={() => {
                        setIsWorkspacePopoverOpen(
                          (currentOpen) => !currentOpen,
                        );
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Building2 className="text-muted-foreground size-4" />
                        <span>{tOrganizationSwitcher("switchWorkspace")}</span>
                      </div>
                      <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    side="bottom"
                    sideOffset={8}
                    className="w-72 p-0"
                  >
                    <Command>
                      <CommandList>
                        <CommandGroup>
                          {overflowWorkspaces.map((workspace) => (
                            <PopoverClose
                              key={getWorkspaceKey(workspace)}
                              asChild
                            >
                              <CommandItem
                                disabled={isPending}
                                className="flex cursor-pointer items-center gap-2 py-2"
                                onSelect={() => {
                                  handleSelectWorkspaceAndClose(workspace.id);
                                }}
                              >
                                <WorkspaceRow
                                  sessionUser={sessionUser}
                                  workspace={workspace}
                                  subtitle={
                                    workspacePlanLabels[
                                      getWorkspaceKey(workspace)
                                    ]
                                  }
                                />
                                {workspace.id === activeOrganizationId ? (
                                  <Check className="size-4" />
                                ) : null}
                              </CommandItem>
                            </PopoverClose>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    disabled={isPending}
                    className={cn("flex cursor-pointer items-center gap-2")}
                  >
                    <Building2 className="text-muted-foreground size-4" />
                    {tOrganizationSwitcher("switchWorkspace")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72">
                    {overflowWorkspaces.map((workspace) => (
                      <DropdownMenuItem
                        key={getWorkspaceKey(workspace)}
                        className="flex cursor-pointer items-center gap-2 py-2"
                        disabled={isPending}
                        onSelect={(event) => {
                          event.preventDefault();
                          handleSelectWorkspaceAndClose(workspace.id);
                        }}
                      >
                        <WorkspaceRow
                          sessionUser={sessionUser}
                          workspace={workspace}
                          subtitle={
                            workspacePlanLabels[getWorkspaceKey(workspace)]
                          }
                        />
                        {workspace.id === activeOrganizationId ? (
                          <Check className="size-4" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )
            ) : null}
          </DropdownMenuGroup>
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
              onClick={(e) => handleClick(e, "/credits")}
            >
              <CreditCardIcon className="text-muted-foreground" />
              {t("credits")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2"
              onClick={(e) => handleClick(e, "/coupon")}
            >
              <Tag className="text-muted-foreground" />
              {t("coupon")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2"
              onClick={(e) => handleClick(e, "/subscriptions")}
            >
              <WalletCards className="text-muted-foreground" />
              {t("subscriptions")}
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2"
              onClick={(e) => handleClick(e, "/connections")}
            >
              <Cable className="text-muted-foreground" />
              {t("connections")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2"
            onClick={() => {
              setIsWorkspacePopoverOpen(false);
              setIsMenuOpen(false);
              handleSupport();
            }}
          >
            <CircleHelp className="text-muted-foreground" />
            {t("support")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2"
            onClick={() => {
              setIsWorkspacePopoverOpen(false);
              setIsMenuOpen(false);
              showLogoutModal(sessionUser.email);
            }}
          >
            <LogOut className="text-muted-foreground" />
            {t("logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
