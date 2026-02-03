"use client";

import { Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";

interface FileUploadButtonProps {
  label: string;
  onClick?: () => void;
}

export function FileUploadButton({ label, onClick }: FileUploadButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-primary rounded-full"
      aria-label={label}
      onClick={onClick}
    >
      <Paperclip className="size-4" aria-hidden />
    </Button>
  );
}
