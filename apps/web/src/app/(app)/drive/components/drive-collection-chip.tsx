"use client";

import type { FileCollection } from "@sokosumi/core-client";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One saved collection on the All files shelf, with its owner's menu. */
export function DriveCollectionChip({
  collection,
  active,
  disabled,
  saving,
  onOpen,
  onResave,
  onRename,
  onDelete,
}: {
  collection: FileCollection;
  active: boolean;
  disabled: boolean;
  /** Its new name has not saved yet, so it does not read as saved. */
  saving: boolean;
  onOpen: () => void;
  onResave: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("App.Drive.Files");
  return (
    <span
      aria-busy={saving || undefined}
      className={cn("flex items-center", saving && "opacity-60")}
    >
      <Button
        size="sm"
        variant={active ? "secondary" : "outline"}
        disabled={disabled}
        onClick={onOpen}
      >
        {collection.name}
      </Button>
      {collection.isOwner ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              // 44px on touch, which is the minimum this codebase
              // uses elsewhere (`min-h-11`); a 32px target was
              // comfortable with a mouse and a miss with a thumb.
              // `hit-area` covers a wide container on a narrow
              // viewport, where the 32px box applies below md.
              className="hit-area size-11 @2xl:size-8"
              disabled={disabled}
              aria-label={t("collectionActions", {
                name: collection.name,
              })}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onResave}>
              {t("collectionResave")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRename}>
              {t("collectionRename")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              {t("collectionDelete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </span>
  );
}
