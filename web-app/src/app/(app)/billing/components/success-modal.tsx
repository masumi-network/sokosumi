"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { Suspense, use } from "react";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckoutSessionData } from "@/lib/clients";
import { AgentWithCreditsPrice } from "@/lib/db";

import RandomAgentCard from "./random-agent-card";
import SuccessCard, {
  SuccessCardError,
  SuccessCardLoading,
} from "./success-card";

interface BillingSuccessModalProps {
  checkoutSessionPromise: Promise<CheckoutSessionData>;
  randomAgentPromise: Promise<{
    agent: AgentWithCreditsPrice;
    averageExecutionDuration: number;
  } | null>;
}

export default function BillingSuccessModal(props: BillingSuccessModalProps) {
  return (
    <Suspense>
      <BillingSuccessModalInner {...props} />
    </Suspense>
  );
}

function BillingSuccessModalInner(props: BillingSuccessModalProps) {
  const [sessionId, setSessionId] = useQueryState("session_id");

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSessionId(null);
    }
  };

  return (
    <Dialog open={!!sessionId} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/50 backdrop-blur-lg md:bg-auto" />
        <DialogContent className="w-[96vw] max-w-3xl! border-none bg-transparent p-4 focus:ring-0 focus:outline-none [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-svh md:max-h-[90svh]">
            <Suspense fallback={<SuccessCardContentLoading />}>
              <DefaultErrorBoundary fallback={<SuccessCardContentError />}>
                <SuccessCardContentInner {...props} />
              </DefaultErrorBoundary>
            </Suspense>
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function SuccessCardContentInner({
  checkoutSessionPromise,
  randomAgentPromise,
}: BillingSuccessModalProps) {
  const t = useTranslations("App.Billing.Success");
  const checkoutSession = use(checkoutSessionPromise);

  return (
    <SuccessCard checkoutSession={checkoutSession}>
      <div className="space-y-2 text-center">
        <p className="text-muted-foreground text-sm">{t("fulfillmentNote")}</p>
        <Button asChild>
          <Link href="/">{t("backToDashboard")}</Link>
        </Button>
      </div>
      <h1 className="text-foreground text-center text-lg font-light md:text-2xl">
        {t("getStarted")}
      </h1>
      <RandomAgentCard randomAgentPromise={randomAgentPromise} />
    </SuccessCard>
  );
}

function SuccessCardContentLoading() {
  return <SuccessCardLoading />;
}

function SuccessCardContentError() {
  return <SuccessCardError />;
}
