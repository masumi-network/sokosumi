"use client";

import { Share } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";
import type { Job } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import JobShareModal from "./job-share-modal";

interface JobShareModalHostProps {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  job: Job;
}

function JobShareModalHost({
  open,
  onOpenChange,
  job,
}: JobShareModalHostProps) {
  return <JobShareModal open={open} onOpenChange={onOpenChange} job={job} />;
}

interface JobShareButtonProps {
  job: Job;
  label?: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}

export default function JobShareButton({
  job,
  label,
  className,
  variant = "ghost",
  size = "icon",
}: JobShareButtonProps) {
  const t = useTranslations("Components.Jobs.JobDetails.JobShare");
  const resolvedLabel = label ?? t("share");
  const { showModal, Component } = useModal(JobShareModalHost, { job });

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={showModal}
        className={cn(className)}
        title={resolvedLabel}
        aria-label={resolvedLabel}
      >
        <Share className="size-4" />
      </Button>
      {Component}
    </>
  );
}
