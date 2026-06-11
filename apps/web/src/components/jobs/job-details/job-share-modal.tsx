"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CoreApiRequestError,
  coreClient,
} from "@/lib/clients/core.browser.client";
import type { Job, JobShare } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getJobQueryKey } from "@/queries";

interface JobShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
}

export default function JobShareModal({
  open,
  onOpenChange,
  job,
}: JobShareModalProps) {
  const t = useTranslations("Components.Jobs.JobDetails.JobShare.Modal");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);

  // Detect client-side rendering without setState in useEffect
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Derive share state from job data - these will be reset via handleOnOpenChange
  const [jobShare, setJobShare] = useState<JobShare | null>(job.share ?? null);

  // Compute link on client only - derived from jobShare state
  const link =
    isClient && jobShare?.token
      ? new URL(`/share/${jobShare.token}`, window.location.origin)
      : null;

  function syncJobShare(nextJobShare: JobShare | null) {
    setJobShare(nextJobShare);
    queryClient.setQueryData<Job>(getJobQueryKey(job.id), (currentJob) => {
      if (!currentJob) {
        return currentJob;
      }

      return {
        ...currentJob,
        share: nextJobShare,
      };
    });
  }

  const handleOnOpenChange = (open: boolean) => {
    if (isLoading) {
      return;
    }

    // When opening the modal, reset state to match current job data
    if (open) {
      setJobShare(job.share);
    }
    onOpenChange(open);
  };

  function handleShareError(error: unknown) {
    const status =
      error instanceof CoreApiRequestError ? error.status : undefined;

    switch (status) {
      case 401:
        toast.error(t("Errors.unauthenticated"), {
          action: {
            label: t("Errors.unauthenticatedAction"),
            onClick: () => {
              router.push(`/login`);
            },
          },
        });
        break;
      case 403:
        toast.error(t("Errors.unauthorized"));
        break;
      case 404:
        toast.error(t("Errors.jobNotFound"));
        break;
      default:
        toast.error(t("Error.share"));
        break;
    }
  }

  const handleTogglePublicShare = async () => {
    if (jobShare?.token) {
      return;
    }

    setIsLoading(true);
    try {
      const nextJobShare = await coreClient.putJobShare(job.id, {
        allowSearchIndexing: true,
      });
      syncJobShare(nextJobShare);
      toast.success(t("Success.share"));
    } catch (error) {
      handleShareError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAllowSearchIndexingChange = async (
    v: boolean | "indeterminate",
  ) => {
    const checked = v === true;
    if (!jobShare) {
      return;
    }

    setIsLoading(true);
    try {
      const nextJobShare = await coreClient.putJobShare(job.id, {
        allowSearchIndexing: checked,
      });
      syncJobShare(nextJobShare);
      toast.success(t("Success.share"));
    } catch (error) {
      handleShareError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveSharePerJob = async () => {
    if (!jobShare?.token) {
      return;
    }

    setIsLoading(true);
    try {
      await coreClient.deleteJobShare(job.id);
      syncJobShare(null);
      toast.success(t("Success.share"));
    } catch (error) {
      handleShareError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link.toString());
      toast.success(t("Success.copyLink"));
    } catch {
      toast.error(t("Error.copyLink"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogContent className="w-svw max-w-lg! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <ScrollArea className="max-h-svh md:max-h-[90svh]">
          <div className="bg-background min-h-svh w-svw space-y-4 rounded-none p-4 md:min-h-auto md:w-lg md:rounded-xl md:p-8">
            <h1 className="text-xl font-light">{t("title")}</h1>
            <div className="divide-y rounded-md border">
              <div
                className={cn(
                  "hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-t-md p-4 transition-all",
                  {
                    "pointer-events-none animate-pulse opacity-60": isLoading,
                  },
                )}
                onClick={handleTogglePublicShare}
              >
                <Globe />
                <div className="flex-1">
                  <p className="text-sm">{t("publicAccessTitle")}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("publicAccessDescription")}
                  </p>
                </div>
                {jobShare && jobShare.token !== null && (
                  <Check className="text-semantic-success size-4" />
                )}
              </div>
              <div
                className={cn(
                  "hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-b-md p-4 transition-all",
                  {
                    "pointer-events-none animate-pulse opacity-60": isLoading,
                  },
                )}
                onClick={handleRemoveSharePerJob}
              >
                <Lock />
                <div className="flex-1">
                  <p className="text-sm">{t("privateAccessTitle")}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("privateAccessDescription")}
                  </p>
                </div>
                {(!jobShare || jobShare.token === null) && (
                  <Check className="text-semantic-success size-4" />
                )}
              </div>
            </div>
            {link && jobShare?.token !== null && (
              <div className="flex w-full items-center gap-2 rounded-md border p-2">
                <a
                  href={link.toString()}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-muted-foreground truncate text-sm hover:underline"
                >
                  {link.toString()}
                </a>
                <Button variant="ghost" size="icon" onClick={handleCopyLink}>
                  <Copy className="size-4" />
                </Button>
              </div>
            )}
            {jobShare && jobShare.token !== null && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="allow-search-indexing"
                  disabled={isLoading}
                  className={cn({
                    "pointer-events-none animate-pulse opacity-60": isLoading,
                  })}
                  checked={jobShare.allowSearchIndexing}
                  onCheckedChange={(v) => handleAllowSearchIndexingChange(v)}
                />
                <Label htmlFor="allow-search-indexing">
                  {t("allowSearchIndexing")}
                </Label>
              </div>
            )}
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={() => handleOnOpenChange(false)}
              >
                {t("close")}
              </Button>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
