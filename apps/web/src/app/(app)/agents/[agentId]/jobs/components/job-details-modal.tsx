"use client";

import { type JobWithSokosumiStatus } from "@sokosumi/database";
import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { JobDetails } from "@/components/jobs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface JobDetailsModalProps {
  activeOrganizationId: string | null;
  agentId: string;
  job: JobWithSokosumiStatus;
  readOnly: boolean;
}

export function JobDetailsModal({
  activeOrganizationId,
  agentId,
  job,
  readOnly,
}: JobDetailsModalProps) {
  const t = useTranslations("App.Agents.Jobs.Header");
  const [isBelowLg, setIsBelowLg] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1023px)").matches
      : false,
  );
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = "(max-width: 1023px)";
    const mediaQuery = window.matchMedia(query);
    const onChange = () => setIsBelowLg(mediaQuery.matches);

    onChange();
    mediaQuery.addEventListener("change", onChange);

    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  const handleClose = useCallback(() => {
    const qs = searchParams.toString();
    const basePath = `/agents/${agentId}/jobs`;
    router.replace(qs ? `${basePath}?${qs}` : basePath);
  }, [agentId, router, searchParams]);

  if (!isBelowLg) {
    return null;
  }

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="w-svw max-w-3xl border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <ScrollArea className="max-h-svh md:max-h-[90svh]">
          <div className="bg-background min-h-svh w-svw rounded-none p-4 md:min-h-auto md:w-auto md:rounded-xl md:p-6">
            <div className="mb-4 flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 px-2"
                onClick={handleClose}
              >
                <ArrowLeft className="size-4" />
                <span>{t("back")}</span>
              </Button>
            </div>
            <JobDetails
              job={job}
              readOnly={readOnly}
              activeOrganizationId={activeOrganizationId}
              showAgentHeader={false}
            />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
