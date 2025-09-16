import { Check, Copy, Globe, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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
  CommonErrorCode,
  JobErrorCode,
  removeJobShare,
  shareJob,
  updateAllowSearchIndexing,
} from "@/lib/actions";
import { getPublicJobShare, JobWithRelations } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  JobShare,
  ShareAccessType,
  SharePermission,
} from "@/prisma/generated/client";

interface JobShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobWithRelations;
}

export default function JobShareModal({
  open,
  onOpenChange,
  job,
}: JobShareModalProps) {
  const t = useTranslations("Components.Jobs.JobDetails.JobShare.Modal");
  const { id: jobId } = job;

  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [jobShare, setJobShare] = useState<JobShare | null>(null);
  const [link, setLink] = useState<URL | null>(null);

  // Need to refresh after modal is closed
  const needRefresh = useRef(false);

  const publicJobShare = getPublicJobShare(job);

  useEffect(() => {
    if (publicJobShare) {
      setJobShare(publicJobShare);
      setLink(
        new URL(`/share/jobs/${publicJobShare.token}`, window.location.origin),
      );
    } else {
      setJobShare(null);
      setLink(null);
    }
  }, [jobId, publicJobShare, setJobShare, setLink]);

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    // when close JobShareModal
    // refresh router to show updated job-share indicator
    if (!open && needRefresh.current) {
      router.refresh();
    }
    onOpenChange(open);
  };

  const handleShareJob = async () => {
    setLoading(true);
    const result = await shareJob({
      jobId: job.id,
      recipientId: null,
      recipientOrganizationId: null,
      shareAccessType: ShareAccessType.PUBLIC,
      sharePermission: SharePermission.READ,
    });
    if (result.ok) {
      needRefresh.current = true;
      setJobShare(result.data);
      setLink(
        new URL(`/share/jobs/${result.data.token}`, window.location.origin),
      );
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
    setLoading(false);
  };

  const handleAllowSearchIndexingChange = async (
    v: boolean | "indeterminate",
  ) => {
    const checked = v === true;
    if (!jobShare) {
      return;
    }

    setLoading(true);
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
    setLoading(false);
  };

  const handleRemoveJobShare = async () => {
    setLoading(true);
    const result = await removeJobShare({ jobId: job.id });
    if (result.ok) {
      needRefresh.current = true;
      setJobShare(null);
      setLink(null);
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
    setLoading(false);
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
                    "pointer-events-none animate-pulse opacity-60": loading,
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
                  <Check className="h-4 w-4 text-green-500" />
                )}
              </div>
              <div
                className={cn(
                  "hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-b-md p-4 transition-all",
                  {
                    "pointer-events-none animate-pulse opacity-60": loading,
                  },
                )}
                onClick={handleRemoveJobShare}
              >
                <Lock />
                <div className="flex-1">
                  <p className="text-sm">{t("privateAccessTitle")}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("privateAccessDescription")}
                  </p>
                </div>
                {(!jobShare ||
                  jobShare.accessType === ShareAccessType.RESTRICTED) && (
                  <Check className="h-4 w-4 text-green-500" />
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
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            )}
            {jobShare?.accessType === ShareAccessType.PUBLIC && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="allow-search-indexing"
                  disabled={loading}
                  className={cn({
                    "pointer-events-none animate-pulse opacity-60": loading,
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
