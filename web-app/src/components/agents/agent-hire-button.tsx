"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ComponentProps } from "react";

import { useCreateJobModalContext } from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import useWithAuthentication from "@/hooks/use-with-authentication";
import { cn } from "@/lib/utils";

interface AgentHireButtonProps {
  agentId: string;
  size?: ComponentProps<typeof Button>["size"] | undefined;
  className?: string | undefined;
}

function AgentHireButton({
  agentId,
  size = "lg",
  className,
}: AgentHireButtonProps) {
  const t = useTranslations("Components.Agents");
  const { isPending, withAuthentication } = useWithAuthentication();

  const { handleOpen } = useCreateJobModalContext();

  const handleHire = () => {
    handleOpen(agentId);
  };

  return (
    <Button
      size={size}
      variant="primary"
      onClick={withAuthentication(handleHire)}
      disabled={isPending}
      className={cn("cursor-pointer", className)}
    >
      {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {t("hire")}
    </Button>
  );
}

export { AgentHireButton };
