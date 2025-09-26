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

const HYDRA_LINK =
  "https://app.hydra.events/bd923855-d2de-46e6-b0cd-22e96e2c8fd5/?qr=LO-01K5Y5YH04J422AZ8CATBA4HCR";

interface HydraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function HydraDialog({ open, onOpenChange }: HydraDialogProps) {
  const t = useTranslations("App.HydraHandoffDialog");
  const [qrError, setQrError] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setQrError(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(24rem,90vw)] space-y-6">
        <DialogHeader className="space-y-2 text-center sm:text-center">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          <div className="border-border rounded-md border bg-white p-4">
            {qrError ? (
              <div className="flex h-48 w-48 items-center justify-center bg-gray-100 text-sm text-gray-500">
                <p className="text-center">{t("qrError")}</p>
              </div>
            ) : (
              <QRCode
                value={HYDRA_LINK}
                size={192}
                viewBox="0 0 256 256"
                className="h-48 w-48"
                onError={() => setQrError(true)}
                aria-label="QR code for Hydra vending machine"
              />
            )}
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
