"use client";

import type { MemberWithOrganization } from "@sokosumi/utils";
import { Loader2, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { buildWorkspaceMoveTargets } from "@/app/tasks/components/workspace-move-targets";
import { OrganizationLogo } from "@/components/organizations";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { moveJobToWorkspace } from "@/lib/actions/job/action";
import { cn } from "@/lib/utils";

interface MoveJobToWorkspaceDialogProps {
  agentId: string;
  currentOrganizationId: string | null;
  jobId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizations: MemberWithOrganization[];
  personalWorkspaceLabel: string;
}

interface WorkspaceOption {
  id: string;
  organizationId: string | null;
  name: string;
  organization?: MemberWithOrganization["organization"];
}

export function MoveJobToWorkspaceDialog({
  agentId,
  currentOrganizationId,
  jobId,
  onOpenChange,
  open,
  organizations,
  personalWorkspaceLabel,
}: MoveJobToWorkspaceDialogProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Header.Actions");
  const router = useRouter();
  const [selectedValue, setSelectedValue] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const workspaceOptions: WorkspaceOption[] = buildWorkspaceMoveTargets(
    currentOrganizationId,
    organizations,
  ).map((target) =>
    target.id === "personal"
      ? {
          ...target,
          name: personalWorkspaceLabel.trim() || t("personalWorkspace"),
        }
      : {
          ...target,
          name: target.organization?.name ?? target.id,
        },
  );

  const selectedOption = workspaceOptions.find(
    (option) => option.id === selectedValue,
  );

  const handleSubmit = () => {
    if (!selectedOption) {
      return;
    }

    startTransition(async () => {
      try {
        await moveJobToWorkspace({
          agentId,
          jobId,
          organizationId: selectedOption.organizationId,
        });
        toast.success(t("moveToWorkspaceSuccess"));
        onOpenChange(false);
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : t("moveToWorkspaceError");
        toast.error(message);
      }
    });
  };

  const handleOpenChange = (value: boolean) => {
    onOpenChange(value);
    if (!value) {
      setSelectedValue("");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("moveToWorkspaceTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("moveToWorkspaceDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup
          value={selectedValue}
          onValueChange={setSelectedValue}
          className="gap-2 py-2"
        >
          {workspaceOptions.map((option) => (
            <label
              key={option.id}
              htmlFor={`job-workspace-${option.id}`}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors",
                selectedValue === option.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <RadioGroupItem
                value={option.id}
                id={`job-workspace-${option.id}`}
              />
              {option.organization ? (
                <Avatar className="bg-muted size-6 items-center justify-center">
                  <OrganizationLogo
                    organization={option.organization}
                    size={14}
                  />
                </Avatar>
              ) : (
                <Avatar className="bg-muted flex size-6 items-center justify-center">
                  <User className="text-muted-foreground size-3.5" />
                </Avatar>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {option.name}
              </span>
            </label>
          ))}
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {t("moveToWorkspaceCancel")}
          </AlertDialogCancel>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !selectedOption}
          >
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {t("moveToWorkspaceButton")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
