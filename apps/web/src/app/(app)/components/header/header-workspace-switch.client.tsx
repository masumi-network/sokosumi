"use client";

import type { MemberWithOrganization } from "@sokosumi/database";
import gravatarUrl from "gravatar-url";
import { Check, ChevronDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import UserAvatarContent from "@/app/components/user-avatar/user-avatar-content";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import {
  OrganizationInformationModal,
  OrganizationLogo,
} from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import useModal from "@/hooks/use-modal";
import type { SessionUser } from "@/lib/auth/auth";
import { cn } from "@/lib/utils";

interface HeaderWorkspaceSwitchProps {
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
      <Avatar className="bg-muted size-6 items-center justify-center">
        <OrganizationLogo organization={workspace.organization} size={14} />
      </Avatar>
    );
  }

  return (
    <UserAvatarContent
      className="size-6 md:size-6"
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

function WorkspaceMenuItem({
  sessionUser,
  workspace,
  isSelected,
  isPending,
  onSelect,
}: {
  sessionUser: SessionUser;
  workspace: WorkspaceItem;
  isSelected: boolean;
  isPending: boolean;
  onSelect: (workspaceId: string | null) => void;
}) {
  return (
    <DropdownMenuItem
      className="flex cursor-pointer items-center gap-2 py-2"
      disabled={isPending}
      onClick={() => onSelect(workspace.id)}
    >
      <WorkspaceAvatar sessionUser={sessionUser} workspace={workspace} />
      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
      <Check
        className={cn("size-4", isSelected ? "opacity-100" : "opacity-0")}
      />
    </DropdownMenuItem>
  );
}

export default function HeaderWorkspaceSwitch({
  sessionUser,
  members,
  activeOrganizationId,
}: HeaderWorkspaceSwitchProps) {
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();
  const {
    Component: CreateOrganizationModal,
    showModal: showCreateOrganizationModal,
  } = useModal(OrganizationInformationModal, {
    organization: null,
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const personalWorkspace = useMemo<WorkspaceItem>(
    () => ({
      id: null,
      name:
        sessionUser.name ??
        sessionUser.email ??
        tOrganizationSwitcher("personalAccount"),
    }),
    [sessionUser.email, sessionUser.name, tOrganizationSwitcher],
  );

  const organizationWorkspaces = useMemo(
    () =>
      getOrderedWorkspaces(
        members.map((member) => ({
          id: member.organization.id,
          name: member.organization.name,
          organization: member.organization,
        })),
        activeOrganizationId,
      ),
    [activeOrganizationId, members],
  );

  const activeWorkspace =
    activeOrganizationId === null
      ? personalWorkspace
      : (organizationWorkspaces.find(
          (workspace) => workspace.id === activeOrganizationId,
        ) ?? personalWorkspace);

  const handleWorkspaceSelect = (workspaceId: string | null) => {
    setIsDropdownOpen(false);
    handleSelectWorkspace(workspaceId);
  };

  const handleAddOrganization = () => {
    setIsDropdownOpen(false);
    showCreateOrganizationModal();
  };

  return (
    <>
      {CreateOrganizationModal}
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
            disabled={isPending}
          >
            <div className="min-w-0 flex-col items-start">
              <div className="truncate font-medium">
                {activeWorkspace?.name}
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {sessionUser.email}
              </div>
            </div>
            <ChevronDown className="text-muted-foreground size-4 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="end">
          <WorkspaceMenuItem
            sessionUser={sessionUser}
            workspace={personalWorkspace}
            isSelected={activeOrganizationId === null}
            isPending={isPending}
            onSelect={handleWorkspaceSelect}
          />
          {organizationWorkspaces.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                {tOrganizationSwitcher("organizationsHeading")}
              </DropdownMenuLabel>
              {organizationWorkspaces.map((workspace) => (
                <WorkspaceMenuItem
                  key={getWorkspaceKey(workspace)}
                  sessionUser={sessionUser}
                  workspace={workspace}
                  isSelected={workspace.id === activeOrganizationId}
                  isPending={isPending}
                  onSelect={handleWorkspaceSelect}
                />
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2 py-2"
            onClick={handleAddOrganization}
          >
            <Avatar className="bg-primary/10 flex size-6 items-center justify-center gap-2">
              <Plus className="text-primary size-4" />
            </Avatar>
            <span>{tOrganizationSwitcher("addOrganization")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
