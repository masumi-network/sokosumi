"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import QRCode from "react-qr-code";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getEnvPublicConfig } from "@/config/env.public";

const HYDRA_LINK =
  "https://app.hydra.events/bd923855-d2de-46e6-b0cd-22e96e2c8fd5/?qr=LO-01K5Y5YH04J422AZ8CATBA4HCR";
const STORAGE_KEY = "hydra-handoff-dialog:seen";
const FEATURE_FLAG =
  getEnvPublicConfig().NEXT_PUBLIC_ENABLE_MOBILE_HYDRA_DIALOG;

export default function HydraHandoffDialog() {
  const t = useTranslations("App.HydraHandoffDialog");
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[min(24rem,90vw)] space-y-6">
        <DialogHeader className="space-y-2 text-center sm:text-center">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          <div className="border-border rounded-md border bg-white p-4">
            <QRCode
              value={HYDRA_LINK}
              size={192}
              viewBox="0 0 256 256"
              className="h-48 w-48"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Button asChild className="w-full">
            <Link href={HYDRA_LINK} target="_blank" rel="noreferrer">
              {t("button")}
            </Link>
          </Button>
          <p className="text-muted-foreground text-center text-xs break-all">
            {HYDRA_LINK}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
