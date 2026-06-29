"use client";

import {
  Download,
  ExternalLink,
  FileText,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DesignMdFileRowLabels {
  actionsMenu: string;
  confirmRemove: string;
  download: string;
  edit: string;
  preview: string;
  regenerate: string;
  remove: string;
  removeDialogDescription: string;
  removeDialogTitle: string;
  removing: string;
  rowDownload: string;
  cancel: string;
}

interface DesignMdFileRowProps {
  canManage: boolean;
  description: string;
  designMdUrl: string;
  editHref?: null | string;
  isRemoving: boolean;
  labels: DesignMdFileRowLabels;
  onRegenerateClick: () => void;
  onRemove: () => void;
  previewUrl: null | string;
  title: string;
  websiteSource?: null | string;
}

export function DesignMdFileRow({
  canManage,
  description,
  designMdUrl,
  editHref,
  isRemoving,
  labels,
  onRegenerateClick,
  onRemove,
  previewUrl,
  title,
  websiteSource,
}: DesignMdFileRowProps) {
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);

  return (
    <AlertDialog open={isRemoveDialogOpen} onOpenChange={setIsRemoveDialogOpen}>
      <div className="hover:bg-accent/50 focus-within:ring-ring/40 relative flex items-start gap-3 rounded-lg border p-4 transition focus-within:ring-[3px]">
        <a
          href={designMdUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="absolute inset-0 rounded-lg outline-none"
        >
          <span className="sr-only">{labels.rowDownload}</span>
        </a>
        <div className="bg-accent pointer-events-none flex size-10 shrink-0 items-center justify-center rounded-md">
          <FileText className="text-muted-foreground size-5" />
        </div>
        <div className="pointer-events-none min-w-0 flex-1 space-y-1">
          <p className="font-medium text-sm">{title}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
          {websiteSource ? (
            <p className="text-muted-foreground truncate text-xs">
              {websiteSource}
            </p>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative z-10 -m-1 size-8 shrink-0"
              aria-label={labels.actionsMenu}
              disabled={isRemoving}
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={designMdUrl} target="_blank" rel="noreferrer noopener">
                <Download className="size-4" />
                {labels.download}
              </a>
            </DropdownMenuItem>
            {previewUrl ? (
              <DropdownMenuItem asChild>
                <a href={previewUrl} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="size-4" />
                  {labels.preview}
                </a>
              </DropdownMenuItem>
            ) : null}
            {canManage && editHref ? (
              <DropdownMenuItem asChild>
                <Link href={editHref}>
                  <Pencil className="size-4" />
                  {labels.edit}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canManage ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onRegenerateClick}>
                  <RefreshCw className="size-4" />
                  {labels.regenerate}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(event) => {
                    event.preventDefault();
                    setIsRemoveDialogOpen(true);
                  }}
                >
                  <Trash2 className="size-4" />
                  {isRemoving ? labels.removing : labels.remove}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.removeDialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {labels.removeDialogDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemoving}>
            {labels.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isRemoving}
            onClick={() => {
              onRemove();
            }}
          >
            {isRemoving ? labels.removing : labels.confirmRemove}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
