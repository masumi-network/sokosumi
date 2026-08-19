"use client";

import { HardDrive, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("App.Drive");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuItem onClick={onUploadClick}>
          <Upload className="size-4" />
          <span>{t("uploadFile")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDriveClick}>
          <HardDrive className="size-4" />
          <span>{t("fromDrive")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
