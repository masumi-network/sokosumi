"use client";

import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";

import { ConfettiBurst } from "@/components/ui/confetti-burst";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CoworkerOption } from "@/lib/types/coworker";

import { PurchaseSuccessCoworkerRow } from "./purchase-success-coworker-row";

interface PurchaseSuccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headline: string;
  description: string;
  coworkersPromise: Promise<CoworkerOption[]>;
}

/**
 * Shared post-purchase celebration — used after buying credits, redeeming a
 * coupon, or upgrading a subscription (personal or organization). Ends with
 * a pick to start a task with a coworker; the "nice animation" payoff itself
 * happens on the far side of that pick, in the existing
 * `TaskCreatedCelebration` once the task is actually submitted — this modal's
 * job is just to look good on entry and hand off cleanly.
 */
export function PurchaseSuccessModal({
  open,
  onOpenChange,
  headline,
  description,
  coworkersPromise,
}: PurchaseSuccessModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <PurchaseSuccessModalContent
          key={headline}
          headline={headline}
          description={description}
          coworkersPromise={coworkersPromise}
        />
      </DialogContent>
    </Dialog>
  );
}

function PurchaseSuccessModalContent({
  headline,
  description,
  coworkersPromise,
}: Omit<PurchaseSuccessModalProps, "open" | "onOpenChange">) {
  const t = useTranslations("App.Billing.PurchaseSuccess");
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex flex-col items-center gap-6 py-2 text-center">
      <div className="relative">
        {reduceMotion ? null : (
          <ConfettiBurst className="pointer-events-none absolute top-1/2 left-1/2 z-10" />
        )}
        <motion.div
          className="bg-primary/10 flex size-14 items-center justify-center rounded-full"
          initial={reduceMotion ? false : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 360, damping: 22, delay: 0.1 }
          }
        >
          <Check
            className="text-primary size-7"
            strokeWidth={2.5}
            aria-hidden
          />
        </motion.div>
      </div>

      <motion.div
        className="space-y-1.5"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduceMotion ? 0 : 0.35, duration: 0.4 }}
      >
        <DialogTitle className="text-xl font-semibold tracking-tight">
          {headline}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          {description}
        </DialogDescription>
      </motion.div>

      <motion.div
        className="border-border/60 w-full space-y-4 border-t pt-6"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduceMotion ? 0 : 0.5, duration: 0.4 }}
      >
        <div className="space-y-1">
          <p className="text-foreground text-sm font-medium">
            {t("coworkerRowTitle")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("coworkerRowDescription")}
          </p>
        </div>
        <PurchaseSuccessCoworkerRow coworkersPromise={coworkersPromise} />
      </motion.div>
    </div>
  );
}
