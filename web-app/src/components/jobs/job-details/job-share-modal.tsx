import { Check, Copy, Globe, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import {
  CommonErrorCode,
  JobErrorCode,
  removeJobShare,
  shareJob,
} from "@/lib/actions";
import { isPubliclyShared, JobWithRelations } from "@/lib/db";
import { cn } from "@/lib/utils";
import { ShareAccessType, SharePermission } from "@/prisma/generated/client";

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
  const [link, setLink] = useState<URL | null>(null);
  const [selectedAccessType, setSelectedAccessType] = useState<ShareAccessType>(
    ShareAccessType.RESTRICTED,
  );
  const sharedPublicly = isPubliclyShared(job);

  useEffect(() => {
    if (sharedPublicly) {
      setSelectedAccessType(ShareAccessType.PUBLIC);
      setLink(new URL(`/share/jobs/${jobId}`, window.location.origin));
    } else {
      setSelectedAccessType(ShareAccessType.RESTRICTED);
      setLink(null);
    }
  }, [jobId, sharedPublicly, setLink, setSelectedAccessType]);

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    onOpenChange(open);
  };

  const handleShareJob = async () => {
    setLoading(true);
    const result = await shareJob(
      job.id,
      null,
      null,
      ShareAccessType.PUBLIC,
      SharePermission.READ,
    );
    if (result.ok) {
      setLink(new URL(`/share/jobs/${job.id}`, window.location.origin));
      setSelectedAccessType(ShareAccessType.PUBLIC);
      toast.success(t("Success.share"));
      router.refresh();
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

  const handleRemoveJobShare = async () => {
    setLoading(true);
    const result = await removeJobShare(job.id);
    if (result.ok) {
      setLink(null);
      setSelectedAccessType(ShareAccessType.RESTRICTED);
      toast.success(t("Success.share"));
      router.refresh();
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
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg md:bg-auto" />
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
                  {selectedAccessType === ShareAccessType.PUBLIC && (
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
                  {selectedAccessType === ShareAccessType.RESTRICTED && (
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
      </DialogPortal>
    </Dialog>
  );
}
