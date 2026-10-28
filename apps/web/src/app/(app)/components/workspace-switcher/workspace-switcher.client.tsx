"use client";

import type { UserWorkspace } from "@sokosumi/core-client";
import type { SessionUser } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, use, useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { CreateOrganizationWizard } from "@/components/organizations/create-organization-wizard/create-organization-wizard";
import type { OrganizationLogoSource } from "@/components/organizations/organization-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import useModal from "@/hooks/use-modal";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors/error-codes/workspace-gate";
import { createPersonalWorkspaceAction } from "@/lib/actions/workspace-gate/action";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import type { WorkspaceSwitcherPlacement } from "./workspace-switcher-skeleton";

type WorkspaceChoice = "personal" | "organization";

export interface WorkspaceItem {
  id: string | null;
  name: string;
  organization?: OrganizationLogoSource;
}

interface WorkspaceSwitcherState {
  sessionUser: SessionUser;
  /** Null when the user has no personal workspace. */
  personalWorkspace: WorkspaceItem | null;
  /** The active one first. */
  organizationWorkspaces: WorkspaceItem[];
  activeOrganizationId: string | null;
  /** Null until the active workspace is one the list knows. */
  activeWorkspace: WorkspaceItem | null;
  /** A switch is under way. */
  isPending: boolean;
  /** A switch or a personal workspace's creation is under way. */
  isBusy: boolean;
  /** The placement whose menu is open, if any: one at a time. */
  openPlacement: WorkspaceSwitcherPlacement | null;
  setMenuOpen: (placement: WorkspaceSwitcherPlacement, open: boolean) => void;
  selectWorkspace: (workspaceId: string | null) => void;
  openCreateWorkspace: () => void;
}

const WorkspaceSwitcherContext = createContext<WorkspaceSwitcherState | null>(
  null,
);

export function useWorkspaceSwitcherState(): WorkspaceSwitcherState {
  const state = use(WorkspaceSwitcherContext);
  if (!state) {
    throw new Error(
      "useWorkspaceSwitcherState must be used within WorkspaceSwitcherProvider",
    );
  }
  return state;
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

interface WorkspaceSwitcherProviderProps {
  sessionUser: SessionUser;
  /** Core's workspaces list (ADR 0051), read once by the app frame. */
  workspaces: UserWorkspace[];
  /** The server's view; the client session wins once it has one. */
  activeOrganizationId: string | null;
  children: ReactNode;
}

/**
 * The one owner of the **Workspace switcher** (GLOSSARY.md). The sidebar
 * header and the phone's top bar each place a trigger, and CSS shows one, so
 * the first paint is right without knowing the viewport. What is behind the
 * triggers lives here once: the session subscription, which menu is open, the
 * create-workspace dialog and the organization wizard.
 */
export function WorkspaceSwitcherProvider({
  sessionUser,
  workspaces,
  activeOrganizationId: serverActiveOrganizationId,
  children,
}: WorkspaceSwitcherProviderProps) {
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const tIdentity = useTranslations("WorkspaceGate.Identity");
  const { data: clientSession } = useSession();
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();
  const {
    Component: CreateOrganizationModal,
    showModal: showCreateOrganizationModal,
  } = useModal(CreateOrganizationWizard);
  const [openPlacement, setOpenPlacement] =
    useState<WorkspaceSwitcherPlacement | null>(null);
  const [isChoiceDialogOpen, setIsChoiceDialogOpen] = useState(false);
  const [workspaceChoice, setWorkspaceChoice] =
    useState<WorkspaceChoice>("personal");
  const [isCreatingPersonal, setIsCreatingPersonal] = useState(false);

  const clientActiveOrganizationId =
    clientSession?.session.activeOrganizationId;
  const liveActiveOrganizationId =
    clientActiveOrganizationId !== undefined
      ? clientActiveOrganizationId
      : serverActiveOrganizationId;
  const activeOrganizationId = isPending
    ? serverActiveOrganizationId
    : liveActiveOrganizationId;

  const hasPersonalWorkspace = workspaces.some(
    ({ kind }) => kind === "personal",
  );

  const personalWorkspace = useMemo<WorkspaceItem | null>(
    () =>
      hasPersonalWorkspace
        ? {
            id: null,
            name:
              sessionUser.name ??
              sessionUser.email ??
              tOrganizationSwitcher("personalAccount"),
          }
        : null,
    [
      hasPersonalWorkspace,
      sessionUser.email,
      sessionUser.name,
      tOrganizationSwitcher,
    ],
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
      ? personalWorkspace
      : (organizationWorkspaces.find(
          (workspace) => workspace.id === activeOrganizationId,
        ) ?? null);

  function setMenuOpen(placement: WorkspaceSwitcherPlacement, open: boolean) {
    setOpenPlacement((current) =>
      open ? placement : current === placement ? null : current,
    );
  }

  function selectWorkspace(workspaceId: string | null) {
    if (workspaceId === null && !personalWorkspace) {
      return;
    }
    setOpenPlacement(null);
    handleSelectWorkspace(workspaceId);
  }

  async function activateCreatedPersonalWorkspace(): Promise<void> {
    try {
      await handleSelectWorkspace(null);
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

  function openCreateWorkspace() {
    setOpenPlacement(null);
    if (personalWorkspace) {
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

  const state: WorkspaceSwitcherState = {
    sessionUser,
    personalWorkspace,
    organizationWorkspaces,
    activeOrganizationId,
    activeWorkspace,
    isPending,
    isBusy: isPending || isCreatingPersonal,
    openPlacement,
    setMenuOpen,
    selectWorkspace,
    openCreateWorkspace,
  };

  return (
    <WorkspaceSwitcherContext value={state}>
      {children}
      {CreateOrganizationModal}
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
    </WorkspaceSwitcherContext>
  );
}
