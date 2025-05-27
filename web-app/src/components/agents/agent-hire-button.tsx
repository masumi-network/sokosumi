"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ComponentProps } from "react";

import { useCreateJobModalContext } from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import useWithAuthentication from "@/hooks/use-with-authentication";

interface AgentHireButtonProps {
  size?: ComponentProps<typeof Button>["size"] | undefined;
}

function AgentHireButton({ size = "lg" }: AgentHireButtonProps) {
  const t = useTranslations("Components.Agents");
  const { isPending, ModalComponent, withAuthentication } =
    useWithAuthentication();

  const { setOpen } = useCreateJobModalContext();

  const handleHire = () => {
    setOpen(true);
  };

  return (
    <>
      {ModalComponent}
      <Button
        size={size}
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
