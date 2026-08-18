"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type TouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { JobDetails } from "@/components/jobs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Job, MemberWithOrganization } from "@/lib/clients/generated/core";

interface JobDetailsModalProps {
  agentId: string;
  job: Job;
  organizations?: MemberWithOrganization[];
  hasPersonalWorkspace?: boolean;
  personalWorkspaceLabel?: string;
  projectName?: string | null;
  readOnly: boolean;
}

export function JobDetailsModal({
  agentId,
  job,
  organizations,
  hasPersonalWorkspace = false,
  personalWorkspaceLabel,
  projectName,
  readOnly,
}: JobDetailsModalProps) {
  const t = useTranslations("App.Agents.Jobs.Modal");
  const [isOpen, setIsOpen] = useState(true);
  const [isBelowLg, setIsBelowLg] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  useEffect(() => {
    const query = "(max-width: 1023px)";
    const mediaQuery = window.matchMedia(query);
    const onChange = () => setIsBelowLg(mediaQuery.matches);

    onChange();
    mediaQuery.addEventListener("change", onChange);

    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    const qs = searchParams.toString();
    const basePath = `/agents/${agentId}/jobs`;
    router.replace(qs ? `${basePath}?${qs}` : basePath);
  }, [agentId, router, searchParams]);

  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }

      const startX = touchStartXRef.current;
      const startY = touchStartYRef.current;
      touchStartXRef.current = null;
      touchStartYRef.current = null;

      if (startX === null || startY === null) {
        return;
      }

      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const isRightSwipe = deltaX > 80 && Math.abs(deltaY) < 60;

      if (isRightSwipe) {
        handleClose();
      }
    },
    [handleClose],
  );

  if (!isBelowLg) {
    return null;
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => !nextOpen && handleClose()}
    >
      <DialogContent className="w-svw max-w-3xl border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <ScrollArea className="max-h-svh md:max-h-[90svh]">
          <div
            data-testid="job-details-modal-surface"
            className="bg-background min-h-svh w-svw rounded-none p-4 md:min-h-0 md:w-auto md:rounded-xl md:p-6"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
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
              organizations={organizations}
              hasPersonalWorkspace={hasPersonalWorkspace}
              personalWorkspaceLabel={personalWorkspaceLabel}
              projectName={projectName}
              readOnly={readOnly}
              showAgentHeader={false}
            />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
