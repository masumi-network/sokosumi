"use client";

import { MemberRole, MemberWithOrganization } from "@sokosumi/database";
import gravatarUrl from "gravatar-url";
import {
  Building2,
  Cable,
  Check,
  ChevronDown,
  ChevronsUpDown,
  CircleHelp,
  LogOut,
  ReceiptText,
  User as UserIcon,
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
import { Progress } from "@/components/ui/progress";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SessionUser } from "@/lib/auth/auth";
import { CreditUsage } from "@/lib/types/credit";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

import UserAvatarContent from "./user-avatar-content";
import { useWorkspaceSwitcher } from "./workspace-switcher";

interface UserAvatarClientProps {
  creditUsage?: CreditUsage | null;
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
  creditUsage?: CreditUsage | null;
  creditsLabel?: string;
  creditsUsedLabel?: string;
  progressAriaLabel?: string;
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

function WorkspaceRow({
  creditUsage,
  creditsLabel,
  creditsUsedLabel,
  progressAriaLabel,
  sessionUser,
  subtitle,
  workspace,
}: WorkspaceRowProps) {
  const tooltipLabel = creditsLabel;

  const content = (
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
      <div className="flex w-full min-w-0 flex-col items-start">
        <div className="w-full truncate text-sm font-semibold">
          {workspace.name}
        </div>
        {subtitle && !creditsLabel ? (
          <div className="text-muted-foreground w-full truncate text-xs">
            {subtitle}
          </div>
        ) : null}
        {creditUsage?.hasUsageData ? (
          <div className="mt-1 w-full space-y-1">
            <Progress
              className="h-1.5"
              value={creditUsage.percentageUsed}
              aria-label={progressAriaLabel}
            />
            {creditsUsedLabel ? (
              <div className="text-muted-foreground w-fit text-[11px]">
                {creditsUsedLabel}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  return tooltipLabel ? (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    content
  );
}

export default function UserAvatarClient({
  creditUsage,
  creditsLabel,
  primaryLabel,
  secondaryLabel,
  sessionUser,
  members,
  activeOrganizationId,
  workspacePlanLabels,
}: UserAvatarClientProps) {
  const t = useTranslations("Components.UserAvatar");
  const activeOrganizationMember = activeOrganizationId
    ? members.find((member) => member.organizationId === activeOrganizationId)
    : null;
  const canViewBilling =
    !activeOrganizationId ||
    activeOrganizationMember?.role === MemberRole.OWNER ||
    activeOrganizationMember?.role === MemberRole.ADMIN;
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();
  const activeCreditUsage = creditUsage?.hasUsageData ? creditUsage : null;
  const hasCreditUsage = Boolean(activeCreditUsage);
  const creditUsageAriaLabel = t("creditsConsumedProgressAria");
  const creditUsageLabel = activeCreditUsage
    ? t("creditsUsedOfTotal", {
        used: formatCreditsForDisplay(activeCreditUsage.used),
        total: formatCreditsForDisplay(activeCreditUsage.total),
      })
    : null;

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
                className={cn(
                  "mb-1 flex cursor-pointer items-center justify-between gap-2 py-2",
                  workspace.id === activeOrganizationId && "text-primary",
                )}
                disabled={isPending}
                onSelect={() => {
                  handleSelectWorkspaceAndClose(workspace.id);
                }}
              >
                <WorkspaceRow
                  creditUsage={
                    workspace.id === activeOrganizationId && hasCreditUsage
                      ? creditUsage
                      : null
                  }
                  creditsLabel={
                    workspace.id === activeOrganizationId
                      ? creditsLabel
                      : undefined
                  }
                  creditsUsedLabel={creditUsageLabel ?? undefined}
                  progressAriaLabel={creditUsageAriaLabel}
                  sessionUser={sessionUser}
                  workspace={workspace}
                  subtitle={
                    workspace.id === activeOrganizationId
                      ? undefined
                      : workspacePlanLabels[getWorkspaceKey(workspace)]
                  }
                />
                <Check
                  className={cn(
                    "size-4",
                    workspace.id === activeOrganizationId
                      ? "text-primary opacity-100"
                      : "opacity-0",
                  )}
                />
              </DropdownMenuItem>
            ))}
            {overflowWorkspaces.length > 0 ? (
              isMobile ? (
                <Popover
                  modal={false}
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
                                  creditUsage={
                                    workspace.id === activeOrganizationId &&
                                    hasCreditUsage
                                      ? creditUsage
                                      : null
                                  }
                                  creditsLabel={
                                    workspace.id === activeOrganizationId
                                      ? creditsLabel
                                      : undefined
                                  }
                                  creditsUsedLabel={
                                    creditUsageLabel ?? undefined
                                  }
                                  progressAriaLabel={creditUsageAriaLabel}
                                  sessionUser={sessionUser}
                                  workspace={workspace}
                                  subtitle={
                                    workspace.id === activeOrganizationId
                                      ? undefined
                                      : workspacePlanLabels[
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
                        onSelect={() => {
                          handleSelectWorkspaceAndClose(workspace.id);
                        }}
                      >
                        <WorkspaceRow
                          creditUsage={
                            workspace.id === activeOrganizationId &&
                            hasCreditUsage
                              ? creditUsage
                              : null
                          }
                          creditsLabel={
                            workspace.id === activeOrganizationId
                              ? creditsLabel
                              : undefined
                          }
                          creditsUsedLabel={creditUsageLabel ?? undefined}
                          progressAriaLabel={creditUsageAriaLabel}
                          sessionUser={sessionUser}
                          workspace={workspace}
                          subtitle={
                            workspace.id === activeOrganizationId
                              ? undefined
                              : workspacePlanLabels[getWorkspaceKey(workspace)]
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
              onClick={(e: React.MouseEvent) => handleClick(e, "/account")}
            >
              <UserIcon className="text-muted-foreground" />
              {t("account")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2"
              onClick={(e: React.MouseEvent) =>
                handleClick(e, "/organizations")
              }
            >
              <Building2 className="text-muted-foreground" />
              {t("organizations")}
            </DropdownMenuItem>
            {canViewBilling ? (
              <DropdownMenuItem
                className="flex cursor-pointer items-center gap-2"
                onClick={(e: React.MouseEvent) => handleClick(e, "/billing")}
              >
                <ReceiptText className="text-muted-foreground" />
                {t("billing")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2"
              onClick={(e: React.MouseEvent) => handleClick(e, "/connections")}
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
