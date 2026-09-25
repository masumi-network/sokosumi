"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { CreateOrganizationWizard } from "@/components/organizations/create-organization-wizard/create-organization-wizard";
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
import { cn } from "@/lib/utils";

type WorkspaceChoice = "personal" | "organization";

/**
 * Create workspace: a personal or organization choice while the user has no
 * personal workspace, else the organization wizard. Mount `dialogs` where
 * they outlive the menu that calls `start`.
 */
export function useCreateWorkspace(
  onSelectWorkspace: (workspaceId: string | null) => void | Promise<void>,
) {
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const {
    Component: CreateOrganizationModal,
    showModal: showCreateOrganizationModal,
  } = useModal(CreateOrganizationWizard);
  const [isChoiceDialogOpen, setIsChoiceDialogOpen] = useState(false);
  const [workspaceChoice, setWorkspaceChoice] =
    useState<WorkspaceChoice>("personal");
  const [isCreatingPersonal, setIsCreatingPersonal] = useState(false);
  const tIdentity = useTranslations("WorkspaceGate.Identity");

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

  /** Without room for a personal workspace, only an organization is left. */
  function start(canCreatePersonal: boolean) {
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

  const dialogs = (
    <>
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
                "border-input hover:bg-card-background flex cursor-pointer items-start gap-3 rounded-lg border p-4",
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
                "border-input hover:bg-card-background flex cursor-pointer items-start gap-3 rounded-lg border p-4",
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

  return { start, dialogs, isCreatingPersonal };
}
