"use client";

import { CirclePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import { FixedSizeList, ListChildComponentProps } from "react-window";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TagsProps {
  appliedTagNames: string[];
  onApplyTagNames: (tagNames: string[]) => void;
  tagNames: string[];
}

export default function Tags({
  appliedTagNames,
  onApplyTagNames,
  tagNames: validTagNames,
}: TagsProps) {
  const t = useTranslations("App.Gallery.FilterSection");

  const [tagNames, setTagNames] = useState<string[]>(appliedTagNames);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) setTagNames(appliedTagNames);
  }, [open, appliedTagNames, setTagNames]);

  const handleCheckTag = (tagName: string, checked: boolean) => {
    if (checked) {
      setTagNames([...tagNames, tagName]);
    } else {
      setTagNames(tagNames.filter((t) => t !== tagName));
    }
  };

  const Row = ({ index, style }: ListChildComponentProps) => {
    const tagName = validTagNames[index];
    return (
      <DropdownMenuCheckboxItem
        key={tagName}
        onSelect={(e) => e.preventDefault()}
        style={style}
        className="hover:bg-foreground hover:text-white"
        checked={tagNames.includes(tagName)}
        onCheckedChange={(checked) => handleCheckTag(tagName, checked)}
      >
        {tagName}
      </DropdownMenuCheckboxItem>
    );
  };

  return (
    <div className="flex gap-2">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="items-center gap-2 border-dashed text-base"
          >
            {appliedTagNames.length === 0 ? (
              <CirclePlus className="h-4 w-4" />
            ) : (
              <Badge>{appliedTagNames.length}</Badge>
            )}
            {t("tags")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>{t("selectTags")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <FixedSizeList
            height={360}
            itemCount={validTagNames.length}
            width="100%"
            itemSize={36}
          >
            {Row}
          </FixedSizeList>
          <DropdownMenuSeparator />
          <Button
            className="w-full"
            onClick={() => {
              onApplyTagNames(tagNames);
              setOpen(false);
            }}
          >
            {t("applyTags")}
          </Button>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
