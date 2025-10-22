"use client";
import { Check, Copy, Globe, Lock, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  CommonErrorCode,
  getActiveOrganization,
  JobErrorCode,
  removeJobShare,
  shareJob,
  updateAllowSearchIndexing,
} from "@/lib/actions";
import {
  getOrganizationJobShare,
  getPublicJobShare,
  JobWithStatus,
} from "@/lib/db";
import { cn } from "@/lib/utils";
import { JobShare, ShareAccessType } from "@/prisma/generated/client";

interface JobShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobWithStatus;
  activeOrganizationId?: string | null;
}

export default function JobShareModal({
  open,
  onOpenChange,
  job,
  activeOrganizationId,
}: JobShareModalProps) {
  const t = useTranslations("Components.Jobs.JobDetails.JobShare.Modal");
  const { id: jobId } = job;

  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [organization, setOrganization] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Need to refresh after modal is closed
  const needRefresh = useRef(false);
  // Track the last jobId to detect changes
  const lastJobIdRef = useRef(jobId);

  // Detect client-side rendering without setState in useEffect
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const publicJobShare = getPublicJobShare(job);

  // Derive share state from job data - these will be reset via handleOnOpenChange
  const [jobShare, setJobShare] = useState<JobShare | null>(publicJobShare);
  const [organizationJobShare, setOrganizationJobShare] =
    useState<JobShare | null>(
      organization ? getOrganizationJobShare(job, organization.id) : null,
    );

  // Compute link on client only - derived from jobShare state
  const link =
    isClient && jobShare
      ? new URL(`/share/jobs/${jobShare.token}`, window.location.origin)
      : null;

  // Fetch organization data only if activeOrganizationId is provided
  useEffect(() => {
    let mounted = true;

    // If no active organization ID, don't fetch anything
    if (!activeOrganizationId) {
      return;
    }

    const fetchOrganization = async () => {
      try {
        const result = await getActiveOrganization({});
        if (mounted && result.ok && result.data) {
          setOrganization(result.data);
          // Update organization job share after organization is fetched
          if (open) {
            setOrganizationJobShare(
              getOrganizationJobShare(job, result.data.id),
            );
          }
        }
      } catch (error) {
        console.error("Failed to fetch organization:", error);
      }
    };

    if (open) fetchOrganization();
    return () => {
      mounted = false;
    };
  }, [open, activeOrganizationId, job]);

  const handleOnOpenChange = (open: boolean) => {
    if (isLoading) {
      return;
    }

    // When opening the modal, reset state to match current job data
    if (open) {
      // Reset to current job state or detect if job changed
      const jobChanged = lastJobIdRef.current !== jobId;
      if (jobChanged) {
        lastJobIdRef.current = jobId;
      }

      // Reset share state to current job data
      const currentPublicJobShare = getPublicJobShare(job);
      setJobShare(currentPublicJobShare);

      if (organization) {
        setOrganizationJobShare(getOrganizationJobShare(job, organization.id));
      }
    }

    // when close JobShareModal
    // refresh router to show updated job-share indicator
    if (!open && needRefresh.current) {
      router.refresh();
    }
    onOpenChange(open);
  };

  const handleShareJob = async () => {
    setIsLoading(true);
    const result = await shareJob({
      jobId: job.id,
      recipientOrganizationId: null,
      shareAccessType: ShareAccessType.PUBLIC,
    });
    if (result.ok) {
      needRefresh.current = true;
      setJobShare(result.data);
      toast.success(t("Success.share"));
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Errors.unauthenticated"), {
            action: {
              label: t("Errors.unauthenticatedAction"),
              onClick: () => {
                router.push(`/login`);
              },
            },
          });
          break;
        case CommonErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        case JobErrorCode.JOB_NOT_FOUND:
          toast.error(t("Errors.jobNotFound"));
          break;
        default:
          toast.error(t("Error.share"));
          break;
      }
    }
    setIsLoading(false);
  };

  const handleShareWithOrganization = async () => {
    if (!organization) return;

    setIsLoading(true);
    const result = await shareJob({
      jobId: job.id,
      recipientOrganizationId: organization.id,
      shareAccessType: ShareAccessType.RESTRICTED,
    });
    if (result.ok) {
      needRefresh.current = true;
      setOrganizationJobShare(result.data);
      toast.success(t("Success.share"));
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Errors.unauthenticated"), {
            action: {
              label: t("Errors.unauthenticatedAction"),
              onClick: () => {
                router.push(`/login`);
              },
            },
          });
          break;
        case CommonErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        case JobErrorCode.JOB_NOT_FOUND:
          toast.error(t("Errors.jobNotFound"));
          break;
        default:
          toast.error(t("Error.share"));
          break;
      }
    }
    setIsLoading(false);
  };

  const handleAllowSearchIndexingChange = async (
    v: boolean | "indeterminate",
  ) => {
    const checked = v === true;
    if (!jobShare) {
      return;
    }

    setIsLoading(true);
    const result = await updateAllowSearchIndexing({
      jobShareId: jobShare.id,
      allowSearchIndexing: checked,
    });
    if (result.ok) {
      setJobShare(result.data);
      toast.success(t("Success.share"));
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Errors.unauthenticated"), {
            action: {
              label: t("Errors.unauthenticatedAction"),
              onClick: () => {
                router.push(`/login`);
              },
            },
          });
          break;
        case CommonErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        case JobErrorCode.JOB_NOT_FOUND:
          toast.error(t("Errors.jobNotFound"));
          break;
        case JobErrorCode.JOB_SHARE_NOT_FOUND:
          toast.error(t("Errors.jobShareNotFound"));
          break;
        default:
          toast.error(t("Error.share"));
          break;
      }
    }
    setIsLoading(false);
  };

  const handleRemoveOrganizationShare = async () => {
    if (!organization) return;

    setIsLoading(true);
    const result = await removeJobShare({
      jobId: job.id,
      recipientOrganizationId: organization.id,
    });
    if (result.ok) {
      needRefresh.current = true;
      setOrganizationJobShare(null);
      toast.success(t("Success.share"));
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Errors.unauthenticated"), {
            action: {
              label: t("Errors.unauthenticatedAction"),
              onClick: () => {
                router.push(`/login`);
              },
            },
          });
          break;
        case CommonErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        case JobErrorCode.JOB_NOT_FOUND:
          toast.error(t("Errors.jobNotFound"));
          break;
        default:
          toast.error(t("Error.share"));
          break;
      }
    }
    setIsLoading(false);
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
                onClick={handleShareJob}
              >
                <Globe />
                <div className="flex-1">
                  <p className="text-sm">{t("publicAccessTitle")}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("publicAccessDescription")}
                  </p>
                </div>
                {jobShare?.accessType === ShareAccessType.PUBLIC && (
                  <Check className="text-semantic-success size-4" />
                )}
              </div>
              {activeOrganizationId && !organization ? (
                <div className="flex items-center gap-2 p-4">
                  <Skeleton className="size-6 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ) : organization ? (
                <div
                  className={cn(
                    "hover:bg-muted/50 flex cursor-pointer items-center gap-2 p-4 transition-all",
                    {
                      "pointer-events-none animate-pulse opacity-60": isLoading,
                    },
                  )}
                  onClick={
                    organizationJobShare
                      ? handleRemoveOrganizationShare
                      : handleShareWithOrganization
                  }
                >
                  <Users />
                  <div className="flex-1">
                    <p className="text-sm">{t("organizationAccessTitle")}</p>
                    <p className="text-muted-foreground text-xs">
                      {t("organizationAccessDescription", {
                        organizationName: organization.name,
                      })}
                    </p>
                  </div>
                  {organizationJobShare && (
                    <Check className="text-semantic-success size-4" />
                  )}
                </div>
              ) : null}
              <div
                className={cn(
                  "hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-b-md p-4 transition-all",
                  {
                    "pointer-events-none animate-pulse opacity-60": isLoading,
                  },
                )}
                onClick={async () => {
                  setIsLoading(true);
                  const promises = [];

                  if (jobShare) {
                    promises.push(
                      removeJobShare({
                        jobId: job.id,
                        recipientOrganizationId: null,
                      }),
                    );
                  }

                  if (organizationJobShare && organization) {
                    promises.push(
                      removeJobShare({
                        jobId: job.id,
                        recipientOrganizationId: organization.id,
                      }),
                    );
                  }

                  if (promises.length > 0) {
                    try {
                      await Promise.all(promises);
                      needRefresh.current = true;
                      setJobShare(null);
                      setOrganizationJobShare(null);
                      toast.success(t("Success.share"));
                    } catch {
                      toast.error(t("Error.share"));
                    }
                  }

                  setIsLoading(false);
                }}
              >
                <Lock />
                <div className="flex-1">
                  <p className="text-sm">{t("privateAccessTitle")}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("privateAccessDescription")}
                  </p>
                </div>
                {!jobShare && !organizationJobShare && (
                  <Check className="text-semantic-success size-4" />
                )}
              </div>
            </div>
            {link && (
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
            {jobShare?.accessType === ShareAccessType.PUBLIC && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="allow-search-indexing"
                  disabled={isLoading}
                  className={cn({
                    "pointer-events-none animate-pulse opacity-60": isLoading,
                  })}
                  checked={jobShare?.allowSearchIndexing}
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
