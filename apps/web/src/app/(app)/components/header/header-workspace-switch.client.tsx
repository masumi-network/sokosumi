"use client";

import type { SessionUser } from "@sokosumi/utils";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CreateOrganizationWizard } from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import useModal from "@/hooks/use-modal";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors";
import { createPersonalWorkspaceAction } from "@/lib/actions/workspace-gate";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import HeaderWorkspaceAvatar from "./header-workspace-avatar";

type WorkspaceChoice = "personal" | "organization";

interface HeaderWorkspaceSwitchProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  hasPersonalWorkspace: boolean;
  activeOrganizationId: string | null;
  isPending: boolean;
  onSelectWorkspace: (workspaceId: string | null) => void | Promise<void>;
  layout?: "chip" | "row";
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
  return (
    <HeaderWorkspaceAvatar
      sessionUser={sessionUser}
      organization={workspace.organization ?? null}
      className="size-6 md:size-6"
      logoSize={14}
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
  hasPersonalWorkspace,
  activeOrganizationId,
  isPending,
  onSelectWorkspace,
  layout = "chip",
}: HeaderWorkspaceSwitchProps) {
  const isRowLayout = layout === "row";
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const {
    Component: CreateOrganizationModal,
    showModal: showCreateOrganizationModal,
  } = useModal(CreateOrganizationWizard);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isChoiceDialogOpen, setIsChoiceDialogOpen] = useState(false);
  const [workspaceChoice, setWorkspaceChoice] =
    useState<WorkspaceChoice>("personal");
  const [isCreatingPersonal, setIsCreatingPersonal] = useState(false);
  const tIdentity = useTranslations("WorkspaceGate.Identity");
  const canCreatePersonal = !hasPersonalWorkspace;

  async function activateCreatedPersonalWorkspace(): Promise<void> {
    try {
      await onSelectWorkspace(null);
    } catch (error) {
      console.error("Create personal workspace activation failed", error);
      toast.error(tIdentity("personalActivateError"));
    }
  }

  async function createAndActivatePersonal(): Promise<boolean> {
    try {
      const createResult = await createPersonalWorkspaceAction({});
      if (!createResult.ok) {
        if (
          createResult.error.code ===
          WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS
        ) {
          await activateCreatedPersonalWorkspace();
          return true;
        }
        console.error("Create personal workspace failed", createResult.error);
        toast.error(tIdentity("personalCreateError"));
        return false;
      }
      await activateCreatedPersonalWorkspace();
      return true;
    } catch (error) {
      console.error("Create personal workspace failed", error);
      toast.error(tIdentity("personalCreateError"));
      return false;
    }
  }

  function handleOpenCreateWorkspace() {
    setIsDropdownOpen(false);
    if (!canCreatePersonal) {
      showCreateOrganizationModal();
      return;
    }
    setWorkspaceChoice("personal");
    setIsChoiceDialogOpen(true);
  }

  async function handleChoiceContinue() {
    if (workspaceChoice === "organization") {
      setIsChoiceDialogOpen(false);
      showCreateOrganizationModal();
      return;
    }

    setIsCreatingPersonal(true);
    try {
      if (await createAndActivatePersonal()) {
        setIsChoiceDialogOpen(false);
      }
    } finally {
      setIsCreatingPersonal(false);
    }
  }

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
      ? hasPersonalWorkspace
        ? personalWorkspace
        : null
      : (organizationWorkspaces.find(
          (workspace) => workspace.id === activeOrganizationId,
        ) ?? null);

  const handleWorkspaceSelect = (workspaceId: string | null) => {
    if (workspaceId === null && !hasPersonalWorkspace) {
      return;
    }
    setIsDropdownOpen(false);
    onSelectWorkspace(workspaceId);
  };

  return (
    <>
      {CreateOrganizationModal}
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "text-foreground flex min-w-0 items-center text-sm transition-opacity",
              isRowLayout
                ? "hover:bg-accent h-11 w-full gap-2 px-3 font-normal md:h-10"
                : "h-8 hover:opacity-80 md:h-auto",
            )}
            disabled={isPending}
            aria-busy={!activeWorkspace}
            aria-label={
              activeWorkspace
                ? undefined
                : tOrganizationSwitcher("switchWorkspace")
            }
            data-testid={isRowLayout ? "you-workspace-switch" : undefined}
          >
            <div
              className={cn(
                "grid min-w-0 items-center gap-x-1.5",
                isRowLayout
                  ? "w-full grid-cols-[auto_minmax(0,1fr)_auto]"
                  : "grid-cols-[minmax(0,1fr)_auto_auto]",
              )}
            >
              {activeWorkspace ? (
                <>
                  {isRowLayout ? (
                    <HeaderWorkspaceAvatar
                      sessionUser={sessionUser}
                      organization={activeWorkspace.organization ?? null}
                      className="size-4 shrink-0"
                      logoSize={12}
                      decorative
                    />
                  ) : null}
                  <span
                    className={cn(
                      "truncate font-medium",
                      isRowLayout
                        ? "min-w-0 text-left leading-tight"
                        : "max-w-24 text-right leading-none md:max-w-none md:leading-tight",
                    )}
                  >
                    {activeWorkspace.name}
                  </span>
                  {isRowLayout ? null : (
                    <HeaderWorkspaceAvatar
                      sessionUser={sessionUser}
                      organization={activeWorkspace.organization ?? null}
                      className="size-4 shrink-0"
                      logoSize={12}
                      decorative
                    />
                  )}
                </>
              ) : (
                <span
                  data-testid="workspace-switcher-skeleton"
                  className={cn(
                    "col-span-2 flex items-center gap-1.5",
                    isRowLayout ? "justify-start" : "justify-end",
                  )}
                  aria-hidden
                >
                  {isRowLayout ? (
                    <span className="bg-muted size-4 shrink-0 animate-pulse rounded-full" />
                  ) : null}
                  <span className="bg-muted h-3 w-20 animate-pulse rounded-md" />
                  {isRowLayout ? null : (
                    <span className="bg-muted size-4 shrink-0 animate-pulse rounded-full" />
                  )}
                </span>
              )}
              <ChevronsUpDown
                className={cn(
                  "text-muted-foreground size-4 shrink-0 self-center",
                  !isRowLayout && "md:row-span-2 md:size-4.5",
                )}
              />
              {isRowLayout ? null : (
                <span className="text-muted-foreground col-span-2 col-start-1 max-md:hidden max-w-full truncate text-right text-xs leading-tight">
                  {sessionUser.email}
                </span>
              )}
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-72"
          align={isRowLayout ? "start" : "end"}
        >
          {hasPersonalWorkspace ? (
            <WorkspaceMenuItem
              sessionUser={sessionUser}
              workspace={personalWorkspace}
              isSelected={activeOrganizationId === null}
              isPending={isPending || isCreatingPersonal}
              onSelect={handleWorkspaceSelect}
            />
          ) : null}
          {organizationWorkspaces.length > 0 ? (
            <>
              {hasPersonalWorkspace ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                {tOrganizationSwitcher("organizationsHeading")}
              </DropdownMenuLabel>
              {organizationWorkspaces.map((workspace) => (
                <WorkspaceMenuItem
                  key={getWorkspaceKey(workspace)}
                  sessionUser={sessionUser}
                  workspace={workspace}
                  isSelected={workspace.id === activeOrganizationId}
                  isPending={isPending || isCreatingPersonal}
                  onSelect={handleWorkspaceSelect}
                />
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2 py-2"
            disabled={isPending || isCreatingPersonal}
            onClick={handleOpenCreateWorkspace}
          >
            <Avatar className="bg-primary/10 flex size-6 items-center justify-center gap-2">
              <Plus className="text-primary size-4" />
            </Avatar>
            <span>{tOrganizationSwitcher("createWorkspace")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={isChoiceDialogOpen} onOpenChange={setIsChoiceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tOrganizationSwitcher("createWorkspace")}
            </DialogTitle>
            <DialogDescription>{tIdentity("choiceHint")}</DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={workspaceChoice}
            onValueChange={(value) => {
              if (value === "personal" || value === "organization") {
                setWorkspaceChoice(value);
              }
            }}
            aria-label={tIdentity("choiceLabel")}
            className="grid gap-3"
            data-testid="workspace-switcher-create-choice"
            disabled={isCreatingPersonal}
          >
            <Label
              htmlFor="switcher-workspace-choice-personal"
              className={cn(
                "border-input hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                workspaceChoice === "personal" && "border-primary bg-accent/30",
              )}
            >
              <RadioGroupItem
                value="personal"
                id="switcher-workspace-choice-personal"
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">
                  {tIdentity("personalTitle")}
                </span>
                <span className="text-muted-foreground block text-sm font-normal">
                  {tIdentity("personalDescription")}
                </span>
              </span>
            </Label>
            <Label
              htmlFor="switcher-workspace-choice-organization"
              className={cn(
                "border-input hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                workspaceChoice === "organization" &&
                  "border-primary bg-accent/30",
              )}
            >
              <RadioGroupItem
                value="organization"
                id="switcher-workspace-choice-organization"
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">
                  {tIdentity("organizationTitle")}
                </span>
                <span className="text-muted-foreground block text-sm font-normal">
                  {tIdentity("organizationDescription")}
                </span>
              </span>
            </Label>
          </RadioGroup>
          <DialogFooter>
            <Button
              type="button"
              disabled={isCreatingPersonal}
              onClick={() => {
                void handleChoiceContinue();
              }}
            >
              {isCreatingPersonal ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {tIdentity("continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
