"use client";

import type { UserWorkspace } from "@sokosumi/core-client";
import type { SessionUser } from "@sokosumi/utils";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { WorkspaceAvatar } from "@/app/components/user-avatar/workspace-avatar";
import { CreateOrganizationWizard } from "@/components/organizations/create-organization-wizard/create-organization-wizard";
import type { OrganizationLogoSource } from "@/components/organizations/organization-logo";
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
import { useIsMobile } from "@/hooks/use-mobile";
import useModal from "@/hooks/use-modal";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors/error-codes/workspace-gate";
import { createPersonalWorkspaceAction } from "@/lib/actions/workspace-gate/action";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_SWITCHER_AVATAR_CLASS,
  WORKSPACE_SWITCHER_CHEVRON_CLASS,
  WORKSPACE_SWITCHER_NAME_CLASS,
  WORKSPACE_SWITCHER_TRIGGER_CLASS,
  WorkspaceSwitcherSkeletonParts,
} from "./workspace-switcher-skeleton";

type WorkspaceChoice = "personal" | "organization";

interface WorkspaceSwitcherMenuProps {
  sessionUser: SessionUser;
  /** Core's workspaces list; the switcher lists its organizations. */
  workspaces: UserWorkspace[];
  hasPersonalWorkspace: boolean;
  activeOrganizationId: string | null;
  isPending: boolean;
  onSelectWorkspace: (workspaceId: string | null) => void | Promise<void>;
}

interface WorkspaceItem {
  id: string | null;
  name: string;
  organization?: OrganizationLogoSource;
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

export default function WorkspaceSwitcherMenu({
  sessionUser,
  workspaces,
  hasPersonalWorkspace,
  activeOrganizationId,
  isPending,
  onSelectWorkspace,
}: WorkspaceSwitcherMenuProps) {
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const {
    Component: CreateOrganizationModal,
    showModal: showCreateOrganizationModal,
  } = useModal(CreateOrganizationWizard);
  const isMobile = useIsMobile();
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
        workspaces.flatMap(({ organizationId, name, logo, websiteUrl }) =>
          organizationId
            ? [
                {
                  id: organizationId,
                  name,
                  organization: { name, logo, websiteUrl },
                },
              ]
            : [],
        ),
        activeOrganizationId,
      ),
    [activeOrganizationId, workspaces],
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
          {/* One shape for both homes, which never show at once: the phone's
              top bar (name read out, not shown) and, from md, the row that
              fills the sidebar header. */}
          <button
            type="button"
            className={WORKSPACE_SWITCHER_TRIGGER_CLASS}
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
            <ChevronsUpDown className={WORKSPACE_SWITCHER_CHEVRON_CLASS} />
          </button>
        </DropdownMenuTrigger>
        {/* Under the trigger's own edge: its start in the sidebar, its end
            at the phone top bar's right. */}
        <DropdownMenuContent
          className="w-72"
          align={isMobile ? "end" : "start"}
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
            <Avatar className="bg-primary-quinary flex size-6 items-center justify-center gap-2">
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
                "border-control-border press hover:bg-card-background flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                workspaceChoice === "personal" &&
                  "border-primary bg-card-background",
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
                "border-control-border press hover:bg-card-background flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                workspaceChoice === "organization" &&
                  "border-primary bg-card-background",
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
              loading={isCreatingPersonal}
              onClick={() => {
                void handleChoiceContinue();
              }}
            >
              {tIdentity("continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
