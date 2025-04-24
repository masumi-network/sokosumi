"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import useWithAuthentication from "@/hooks/use-with-authentication";

interface FeaturedAgentHireButtonProps {
  agentId: string;
}

export default function FeaturedAgentHireButton({
  agentId,
}: FeaturedAgentHireButtonProps) {
  const t = useTranslations("Landing.Agents.FeaturedAgent");
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
        onClick={withAuthentication(handleHire)}
        disabled={isPending}
      >
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("hire")}
      </Button>
    </>
  );
}
