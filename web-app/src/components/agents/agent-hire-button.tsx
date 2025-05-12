"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import useWithAuthentication from "@/hooks/use-with-authentication";

interface AgentHireButtonProps {
  agentId: string;
}

function AgentHireButton({ agentId }: AgentHireButtonProps) {
  const t = useTranslations("Components.Agents");
  const router = useRouter();
  const { isPending, ModalComponent, withAuthentication } =
    useWithAuthentication();

  const handleHire = () => {
    router.push(`/app/agents/${agentId}/jobs`);
  };

  return (
    <>
      {ModalComponent}
      <Button
        size="lg"
        variant="primary"
        onClick={withAuthentication(handleHire)}
        disabled={isPending}
        className="cursor-pointer"
      >
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("hire")}
      </Button>
    </>
  );
}

export { AgentHireButton };
