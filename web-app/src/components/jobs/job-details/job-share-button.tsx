"use client";

import { Share } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";
import { JobWithStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

import JobShareModal from "./job-share-modal";

interface JobShareButtonProps {
  job: JobWithStatus;
  className?: string;
  activeOrganizationId?: string | null;
}

export default function JobShareButton({
  job,
  className,
  activeOrganizationId,
}: JobShareButtonProps) {
  const t = useTranslations("Components.Jobs.JobDetails.JobShare");
  const { showModal, Component } = useModal(({ open, onOpenChange }) => (
    <JobShareModal
      open={open}
      onOpenChange={onOpenChange}
      job={job}
      activeOrganizationId={activeOrganizationId}
    />
  ));

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={showModal}
        className={cn("text-muted-foreground", className)}
        title={t("share")}
      >
        <Share className="h-4 w-4" />
      </Button>
      {Component}
    </>
  );
}
