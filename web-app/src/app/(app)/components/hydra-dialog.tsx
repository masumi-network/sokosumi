"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import QRCode from "react-qr-code";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { siteConfig } from "@/config/site";

const HYDRA_LINK = siteConfig.links.hydra;

interface HydraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function HydraDialog({ open, onOpenChange }: HydraDialogProps) {
  const t = useTranslations("App.HydraHandoffDialog");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              className="size-48"
              aria-label="QR code for Hydra vending machine"
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
