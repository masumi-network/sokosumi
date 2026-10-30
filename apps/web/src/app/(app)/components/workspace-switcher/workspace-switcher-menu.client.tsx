"use client";

import type { SessionUser } from "@sokosumi/utils";
import { Check, Plus, Settings, UserPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { WorkspaceAvatar } from "@/app/components/user-avatar/workspace-avatar";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SIDEBAR_CONTROL_INTERACTION_CLASS } from "@/components/ui/sidebar-classes";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { cn } from "@/lib/utils";
import {
  useWorkspaceSwitcherState,
  type WorkspaceItem,
} from "./workspace-switcher.client";
import {
  WORKSPACE_SWITCHER_AVATAR_CLASS,
  WORKSPACE_SWITCHER_NAME_CLASS,
  WORKSPACE_SWITCHER_ROW_CLASS,
  WorkspaceSwitcherArrows,
  type WorkspaceSwitcherPlacement,
  WorkspaceSwitcherSkeletonParts,
} from "./workspace-switcher-skeleton";

/**
 * Each placement's own interaction: the sidebar's pill fills on hover and
 * while open, like the controls under it; the top bar's avatar dims like the
 * icons beside it.
 */
const TRIGGER_CLASS: Record<WorkspaceSwitcherPlacement, string> = {
  sidebar: cn(
    WORKSPACE_SWITCHER_ROW_CLASS,
    SIDEBAR_CONTROL_INTERACTION_CLASS,
    "text-foreground press rounded-full transition-[opacity,background-color]",
  ),
  topBar: cn(
    WORKSPACE_SWITCHER_ROW_CLASS,
    "text-foreground press transition-opacity hover:opacity-80",
  ),
};

/** Under the trigger's own edge: its start in the sidebar, its end at the top bar's right. */
const MENU_ALIGN: Record<WorkspaceSwitcherPlacement, "start" | "end"> = {
  sidebar: "start",
  topBar: "end",
};

function getWorkspaceKey(workspace: WorkspaceItem): string {
  return workspace.id ?? "personal-account";
}

interface WorkspaceMenuItemProps {
  sessionUser: SessionUser;
  workspace: WorkspaceItem;
  isSelected: boolean;
  disabled: boolean;
  onSelect: (workspaceId: string | null) => void;
}

function WorkspaceMenuItem({
  sessionUser,
  workspace,
  isSelected,
  disabled,
  onSelect,
}: WorkspaceMenuItemProps) {
  return (
    <DropdownMenuItem
      className="flex cursor-pointer items-center gap-2 py-2"
      disabled={disabled}
      onClick={() => onSelect(workspace.id)}
    >
      <WorkspaceAvatar
        sessionUser={sessionUser}
        organization={workspace.organization ?? null}
        className="size-6 md:size-6"
        logoSize={14}
      />
      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
      <Check
        className={cn("size-4", isSelected ? "opacity-100" : "opacity-0")}
      />
    </DropdownMenuItem>
  );
}

interface ActiveOrganizationHeaderProps {
  sessionUser: SessionUser;
  workspace: WorkspaceItem;
  disabled: boolean;
  onInvite: () => void;
}

/**
 * The organization you are in and what you can do there, pinned above the
 * list so scrolling a long list never takes it out of view. Owners and admins
 * invite; everyone reaches the member list and settings.
 */
function ActiveOrganizationHeader({
  sessionUser,
  workspace,
  disabled,
  onInvite,
}: ActiveOrganizationHeaderProps) {
  const t = useTranslations("Components.OrganizationSwitcher");
  const canInvite =
    workspace.role !== null && isOrganizationOwnerOrAdmin(workspace.role);

  return (
    // Covers the content's own padding too, so rows scroll under it unseen.
    <div className="bg-popover sticky top-0 z-10 -mx-1 -mt-1 px-1 pt-1">
      <div className="flex flex-col gap-3 p-2 pb-3">
        <div className="flex items-center gap-2.5">
          <WorkspaceAvatar
            sessionUser={sessionUser}
            organization={workspace.organization ?? null}
            className="size-9 md:size-9"
            logoSize={20}
            decorative
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{workspace.name}</p>
            <p className="text-muted-foreground text-xs">
              {t("roleAndMemberCount", {
                role: workspace.role ?? "member",
                count: workspace.memberCount ?? 0,
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {canInvite ? (
            <DropdownMenuItem
              className={cn(
                buttonVariants({ variant: "primary", size: "sm" }),
                "focus:bg-primary-hover focus:text-primary-foreground flex-1",
              )}
              disabled={disabled}
              onSelect={onInvite}
            >
              <UserPlus className="text-current" />
              {t("inviteMembers")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            asChild
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              "focus:bg-quaternary focus:text-foreground flex-1",
            )}
            disabled={disabled}
          >
            <Link href="/organization">
              <Settings className="text-current" />
              {canInvite ? t("organizationSettings") : t("membersAndSettings")}
            </Link>
          </DropdownMenuItem>
        </div>
      </div>
      <DropdownMenuSeparator />
    </div>
  );
}

interface WorkspaceSwitcherMenuProps {
  placement: WorkspaceSwitcherPlacement;
}

/**
 * One placement of the **Workspace switcher** (GLOSSARY.md): its trigger and
 * its menu. The menu's items mount only while this placement's menu is open;
 * everything else is the provider's, once.
 */
export default function WorkspaceSwitcherMenu({
  placement,
}: WorkspaceSwitcherMenuProps) {
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const {
    sessionUser,
    personalWorkspace,
    organizationWorkspaces,
    activeOrganizationId,
    activeWorkspace,
    isPending,
    isBusy,
    openPlacement,
    setMenuOpen,
    selectWorkspace,
    openCreateWorkspace,
    openInviteMembers,
  } = useWorkspaceSwitcherState();
  const showOrganizationHeader =
    activeWorkspace !== null && activeOrganizationId !== null;

  return (
    <div
      className={cn(
        "flex h-auto min-w-0 flex-1 items-center gap-1.5",
        isPending
          ? "pointer-events-none animate-pulse opacity-60"
          : "transition-opacity",
      )}
      data-testid="workspace-switcher-chrome"
    >
      <DropdownMenu
        open={openPlacement === placement}
        onOpenChange={(open) => setMenuOpen(placement, open)}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={TRIGGER_CLASS[placement]}
            disabled={isPending}
            aria-busy={!activeWorkspace}
            aria-label={
              activeWorkspace
                ? undefined
                : tOrganizationSwitcher("switchWorkspace")
            }
          >
            {activeWorkspace ? (
              <>
                <WorkspaceAvatar
                  sessionUser={sessionUser}
                  organization={activeWorkspace.organization ?? null}
                  className={WORKSPACE_SWITCHER_AVATAR_CLASS}
                  logoSize={12}
                  decorative
                />
                <span className={WORKSPACE_SWITCHER_NAME_CLASS}>
                  {activeWorkspace.name}
                </span>
              </>
            ) : (
              <span
                data-testid="workspace-switcher-skeleton"
                className="contents"
                aria-hidden
              >
                <WorkspaceSwitcherSkeletonParts />
              </span>
            )}
            <WorkspaceSwitcherArrows placement={placement} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          // The pinned header's height, so a row focused by arrow keys
          // scrolls into view below it, never under it.
          className={cn("w-72", showOrganizationHeader && "scroll-pt-29")}
          align={MENU_ALIGN[placement]}
        >
          {showOrganizationHeader ? (
            <ActiveOrganizationHeader
              sessionUser={sessionUser}
              workspace={activeWorkspace}
              disabled={isBusy}
              onInvite={openInviteMembers}
            />
          ) : null}
          {personalWorkspace ? (
            <WorkspaceMenuItem
              sessionUser={sessionUser}
              workspace={personalWorkspace}
              isSelected={activeOrganizationId === null}
              disabled={isBusy}
              onSelect={selectWorkspace}
            />
          ) : null}
          {organizationWorkspaces.length > 0 ? (
            <>
              {personalWorkspace ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                {tOrganizationSwitcher("organizationsHeading")}
              </DropdownMenuLabel>
              {organizationWorkspaces.map((workspace) => (
                <WorkspaceMenuItem
                  key={getWorkspaceKey(workspace)}
                  sessionUser={sessionUser}
                  workspace={workspace}
                  isSelected={workspace.id === activeOrganizationId}
                  disabled={isBusy}
                  onSelect={selectWorkspace}
                />
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2 py-2"
            disabled={isBusy}
            onClick={openCreateWorkspace}
          >
            <Avatar className="bg-muted flex size-6 items-center justify-center gap-2">
              <Plus className="text-foreground size-4" />
            </Avatar>
            <span>{tOrganizationSwitcher("createWorkspace")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
