"use client";

import type { JobWithSokosumiStatus } from "@sokosumi/database";
import { Share } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";
import { cn } from "@/lib/utils";

import JobShareModal from "./job-share-modal";

interface JobShareButtonProps {
  job: JobWithSokosumiStatus;
  className?: string;
}

export default function JobShareButton({
  job,
  className,
}: JobShareButtonProps) {
  const t = useTranslations("Components.Jobs.JobDetails.JobShare");
  const { showModal, Component } = useModal(({ open, onOpenChange }) => (
    <JobShareModal open={open} onOpenChange={onOpenChange} job={job} />
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
