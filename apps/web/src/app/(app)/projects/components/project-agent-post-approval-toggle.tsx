"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setProjectAgentPostApproval } from "@/lib/actions/project/action";

interface ProjectAgentPostApprovalToggleProps {
  projectId: string;
  initial: boolean;
}

/** Whether Coworker and Soko Bot posts wait for a person to approve them. */
export function ProjectAgentPostApprovalToggle({
  projectId,
  initial,
}: ProjectAgentPostApprovalToggleProps) {
  const t = useTranslations("App.Projects.ProjectSocialAccounts");
  const id = useId();
  const [enabled, setEnabled] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await setProjectAgentPostApproval({
        projectId,
        requireAgentPostApproval: next,
      });
      if (!result.ok) {
        setEnabled(!next);
        toast.error(result.error.message ?? t("agentPostApprovalError"));
      }
    });
  }

  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border p-3"
      data-testid="project-agent-post-approval"
    >
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {t("agentPostApprovalTitle")}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t("agentPostApprovalDescription")}
        </p>
      </div>
      <Switch
        id={id}
        checked={enabled}
        disabled={isPending}
        onCheckedChange={handleChange}
      />
    </div>
  );
}
