"use client";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Button } from "@/components/ui/button";

import HydraDialog from "./hydra-dialog";

interface ClaimHydraPointsButtonProps {
  className?: string;
  disabled?: boolean;
}

export default function ClaimHydraPointsButton({
  className,
  disabled,
}: ClaimHydraPointsButtonProps) {
  const t = useTranslations("App.HydraHandoffDialog");
  const [open, setOpen] = React.useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
  };

  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={handleClick}
        className={className}
        disabled={disabled}
      >
        {t("claimButton")}
      </Button>

      <HydraDialog open={open} onOpenChange={handleOpenChange} />
    </>
  );
}
