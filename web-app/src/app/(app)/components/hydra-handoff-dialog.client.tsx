"use client";

import * as React from "react";

import { getEnvPublicConfig } from "@/config/env.public";

import HydraDialog from "./hydra-dialog";

const STORAGE_KEY = "hydra-handoff-dialog:seen";
const FEATURE_FLAG =
  getEnvPublicConfig().NEXT_PUBLIC_ENABLE_MOBILE_HYDRA_DIALOG;

export default function HydraHandoffDialog() {
  const [open, setOpen] = React.useState(false);
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    setIsHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!FEATURE_FLAG || !isHydrated) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const hasSeenDialog = window.sessionStorage.getItem(STORAGE_KEY) === "true";

    if (!hasSeenDialog) {
      setOpen(true);
      // window.sessionStorage.setItem(STORAGE_KEY, "true");
    }
  }, [isHydrated]);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);

    if (typeof window === "undefined") {
      return;
    }

    if (!nextOpen) {
      window.sessionStorage.setItem(STORAGE_KEY, "true");
    }
  }, []);

  if (!FEATURE_FLAG || !isHydrated || !open) {
    return null;
  }

  return <HydraDialog open={open} onOpenChange={handleOpenChange} />;
}
