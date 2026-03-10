"use client";

import { MemberWithOrganization } from "@sokosumi/database";
import gravatarUrl from "gravatar-url";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import UserAvatarContent from "@/app/components/user-avatar/user-avatar-content";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { OrganizationLogo } from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { SessionUser } from "@/lib/auth/auth";
import { cn } from "@/lib/utils";

interface ProfileSwitchClientProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
}

interface WorkspaceItem {
  id: string | null;
  name: string;
  organization?: MemberWithOrganization["organization"];
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

function WorkspaceAvatar({
  sessionUser,
  workspace,
}: {
  sessionUser: SessionUser;
  workspace: WorkspaceItem;
}) {
  if (workspace.organization) {
    return (
      <Avatar className="bg-muted size-8 items-center justify-center">
        <OrganizationLogo organization={workspace.organization} size={16} />
      </Avatar>
    );
  }

  return (
    <UserAvatarContent
      className="size-8 md:size-8"
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

export default function ProfileSwitchClient({
  sessionUser,
  members,
  activeOrganizationId,
}: ProfileSwitchClientProps) {
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { isMobile, state, toggleSidebar } = useSidebar();
  const canOpenMenu = isMobile || state !== "collapsed";
  const isPopoverVisible = canOpenMenu && isPopoverOpen;
  const isDropdownVisible = canOpenMenu && isDropdownOpen;

  const handlePopoverOpenChange = (open: boolean) => {
    // Do not record open intent when sidebar is collapsed; otherwise when the
    // sidebar is later expanded, isPopoverVisible would flip to true and the
    // popover would open unexpectedly.
    if (open && !isMobile && state === "collapsed") {
      return;
    }
    setIsPopoverOpen(open);
  };
  const handleDropdownOpenChange = (open: boolean) => {
    if (open && !isMobile && state === "collapsed") {
      return;
    }
    setIsDropdownOpen(open);
  };

  useEffect(() => {
    if (isMobile) {
      return;
    }

    if (state === "collapsed") {
      const timer = setTimeout(() => {
        setIsPopoverOpen(false);
        setIsDropdownOpen(false);
      }, 100);
      return () => clearTimeout(timer);
    }
    // When expanding from collapsed, clear any stale open intent. This prevents
    // the popover from opening unexpectedly if isPopoverOpen became true while
    // the sidebar was collapsed (e.g. trigger click).
    const timer = setTimeout(() => {
      setIsPopoverOpen(false);
      setIsDropdownOpen(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [isMobile, state]);

  const workspaces = useMemo(
    () =>
      getOrderedWorkspaces(
        [
          {
            id: null,
            name:
              sessionUser.name ??
              sessionUser.email ??
              tOrganizationSwitcher("personalAccount"),
          },
          ...members.map((member) => ({
            id: member.organization.id,
            name: member.organization.name,
            organization: member.organization,
          })),
        ],
        activeOrganizationId,
      ),
    [
      activeOrganizationId,
      members,
      sessionUser.email,
      sessionUser.name,
      tOrganizationSwitcher,
    ],
  );

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeOrganizationId) ??
    workspaces[0];
  const activeWorkspaceSubtitle = activeWorkspace?.organization
    ? tOrganizationSwitcher("organization")
    : tOrganizationSwitcher("personalAccountHeading");

  const router = useRouter();
  const handleWorkspaceSelect = (workspaceId: string | null) => {
    setIsPopoverOpen(false);
    setIsDropdownOpen(false);
    handleSelectWorkspace(workspaceId);
    if (isMobile) {
      toggleSidebar();
    }
  };

  const handleAddOrganization = () => {
    setIsPopoverOpen(false);
    setIsDropdownOpen(false);
    router.push("/organizations/");
    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <SidebarGroup className="w-full pb-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            {isMobile ? (
              <DropdownMenu
                open={isDropdownVisible}
                onOpenChange={handleDropdownOpenChange}
              >
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    className="min-h-[56px] cursor-pointer items-center md:p-2"
                    aria-label={tOrganizationSwitcher("switchWorkspace")}
                    disabled={isPending}
                  >
                    <div className="text-primary flex w-full items-center gap-2">
                      <span className="group-data-[collapsible=icon]:-ml-2 group-data-[collapsible=icon]:size-8">
                        <WorkspaceAvatar
                          sessionUser={sessionUser}
                          workspace={activeWorkspace}
                        />
                      </span>
                      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                        <div className="truncate text-sm font-medium">
                          {activeWorkspace?.name}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {activeWorkspaceSubtitle}
                        </div>
                      </div>
                      <ChevronsUpDown className="text-muted-foreground size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72" align="start">
                  <DropdownMenuGroup>
                    {workspaces.map((workspace) => {
                      const isSelected = workspace.id === activeOrganizationId;

                      return (
                        <DropdownMenuItem
                          key={getWorkspaceKey(workspace)}
                          className="flex cursor-pointer items-center gap-2 py-2"
                          disabled={isPending}
                          onClick={() => handleWorkspaceSelect(workspace.id)}
                        >
                          <WorkspaceAvatar
                            sessionUser={sessionUser}
                            workspace={workspace}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {workspace.name}
                          </span>
                          <Check
                            className={cn(
                              "size-4",
                              isSelected ? "opacity-100" : "opacity-0",
                            )}
                          />
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="flex cursor-pointer items-center gap-2 py-2"
                    onClick={handleAddOrganization}
                  >
                    <Avatar className="bg-primary/10 flex size-8 items-center justify-center gap-2">
                      <Plus className="text-primary size-4" />
                    </Avatar>
                    <span>{tOrganizationSwitcher("addOrganization")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Popover
                open={isPopoverVisible}
                onOpenChange={handlePopoverOpenChange}
              >
                <PopoverTrigger asChild>
                  <SidebarMenuButton
                    className="min-h-[56px] cursor-pointer items-center md:p-2"
                    aria-label={tOrganizationSwitcher("switchWorkspace")}
                    disabled={isPending}
                  >
                    <div className="text-primary flex w-full items-center gap-2">
                      <span className="group-data-[collapsible=icon]:-ml-2 group-data-[collapsible=icon]:size-8">
                        <WorkspaceAvatar
                          sessionUser={sessionUser}
                          workspace={activeWorkspace}
                        />
                      </span>
                      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                        <div className="truncate text-sm font-medium">
                          {activeWorkspace?.name}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {activeWorkspaceSubtitle}
                        </div>
                      </div>
                      <ChevronsUpDown className="text-muted-foreground size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
                    </div>
                  </SidebarMenuButton>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-0" side="right">
                  <Command>
                    <CommandInput
                      placeholder={tOrganizationSwitcher("searchProfiles")}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {tOrganizationSwitcher("noProfilesFound")}
                      </CommandEmpty>
                      <CommandGroup>
                        {workspaces.map((workspace) => {
                          const isSelected =
                            workspace.id === activeOrganizationId;

                          return (
                            <CommandItem
                              key={getWorkspaceKey(workspace)}
                              value={workspace.name}
                              className="flex cursor-pointer items-center gap-2 py-2"
                              disabled={isPending}
                              onSelect={() =>
                                handleWorkspaceSelect(workspace.id)
                              }
                            >
                              <WorkspaceAvatar
                                sessionUser={sessionUser}
                                workspace={workspace}
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {workspace.name}
                              </span>
                              <Check
                                className={cn(
                                  "size-4",
                                  isSelected ? "opacity-100" : "opacity-0",
                                )}
                              />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                      <CommandSeparator />
                      <CommandGroup>
                        <CommandItem
                          className="flex cursor-pointer items-center gap-2 py-2"
                          onSelect={handleAddOrganization}
                        >
                          <Avatar className="bg-primary/10 flex size-8 items-center justify-center gap-2">
                            <Plus className="text-primary size-4" />
                          </Avatar>
                          <span>
                            {tOrganizationSwitcher("addOrganization")}
                          </span>
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
