"use client";

import { Download, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DesignMdAccessButtonsProps {
  designMdUrl: string | null;
  downloadLabel: string;
  previewLabel: string;
  previewUrl: string | null;
}

export function DesignMdAccessButtons({
  designMdUrl,
  downloadLabel,
  previewLabel,
  previewUrl,
}: DesignMdAccessButtonsProps) {
  if (!designMdUrl && !previewUrl) {
    return null;
  }

  return (
    <>
      {designMdUrl ? (
        <Button asChild type="button" variant="outline">
          <a href={designMdUrl} target="_blank" rel="noreferrer">
            <Download className="size-4" />
            {downloadLabel}
          </a>
        </Button>
      ) : null}
      {previewUrl ? (
        <Button asChild type="button" variant="outline">
          <a href={previewUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            {previewLabel}
          </a>
        </Button>
      ) : null}
    </>
  );
}
