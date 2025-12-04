"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ComponentProps } from "react";

import { useCreateJobModalContext } from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import useWithAuthentication from "@/hooks/use-with-authentication";
import { cn } from "@/lib/utils";

interface AgentDemoButtonProps {
  agentId: string;
  size?: ComponentProps<typeof Button>["size"] | undefined;
  className?: string | undefined;
  disabled?: boolean;
}

export function AgentDemoButton({
  agentId,
  size = "lg",
  className,
  disabled = false,
}: AgentDemoButtonProps) {
  const t = useTranslations("Components.Agents");
  const { isPending, withAuthentication } = useWithAuthentication();

  const { handleOpen } = useCreateJobModalContext();

  const handleDemo = () => {
    handleOpen(agentId, true);
  };

  const handleClick = withAuthentication(handleDemo);

  return (
    <Button
      size={size}
      onClick={handleClick}
      disabled={isPending || disabled}
      className={cn("cursor-pointer", className)}
    >
      {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {t("freeDemo")}
    </Button>
  );
}
