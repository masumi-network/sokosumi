"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { Suspense } from "react";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import DefaultErrorBoundary from "@/components/default-error-boundary";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CoreAgentDto } from "@/lib/types/core-dto";

import RandomAgentCard from "./random-agent-card";
import SuccessCard, {
  SuccessCardError,
  SuccessCardLoading,
} from "./success-card";

interface CreditsSuccessModalProps {
  randomAgentPromise: Promise<{
    agent: CoreAgentDto;
    averageExecutionDuration: number | null;
  } | null>;
  projectOptionsPromise: Promise<ProjectFilterOption[]>;
}

export default function CreditsSuccessModal(props: CreditsSuccessModalProps) {
  return (
    <Suspense>
      <CreditsSuccessModalInner {...props} />
    </Suspense>
  );
}

function CreditsSuccessModalInner(props: CreditsSuccessModalProps) {
  const [sessionId, setSessionId] = useQueryState("session_id");

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSessionId(null);
    }
  };

  return (
    <Dialog open={!!sessionId} onOpenChange={handleOpenChange}>
      <DialogContent className="w-svw max-w-xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
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
    </Dialog>
  );
}

function SuccessCardContentInner({
  randomAgentPromise,
  projectOptionsPromise,
}: CreditsSuccessModalProps) {
  const t = useTranslations("App.Credits.Success");

  return (
    <SuccessCard className="bg-background flex min-h-svh w-svw flex-col rounded-none p-2 md:min-h-auto md:w-auto md:rounded-xl md:p-4">
      <h1 className="text-foreground text-center text-lg font-light md:text-2xl">
        {t("getStarted")}
      </h1>
      <RandomAgentCard
        randomAgentPromise={randomAgentPromise}
        projectOptionsPromise={projectOptionsPromise}
      />
    </SuccessCard>
  );
}

function SuccessCardContentLoading() {
  return <SuccessCardLoading />;
}

function SuccessCardContentError() {
  return <SuccessCardError />;
}
