"use client";

import { HardDrive, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AttachmentSubmenuProps {
  children: React.ReactNode;
  onUploadClick: () => void;
  onDriveClick: () => void;
  disabled?: boolean;
}

export function AttachmentSubmenu({
  children,
  onUploadClick,
  onDriveClick,
  disabled = false,
}: AttachmentSubmenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuItem onClick={onUploadClick}>
          <Upload className="size-4" />
          <span>Upload file</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDriveClick}>
          <HardDrive className="size-4" />
          <span>From Drive</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
